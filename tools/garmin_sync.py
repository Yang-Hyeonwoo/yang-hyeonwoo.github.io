"""Garmin Connect -> the site's data files (runs, class heart rate, sleep).

Runs on GitHub Actions (.github/workflows/garmin.yml) every hour. It reads the watch's records and adds
them to data/log.json and data/daily.json through the same GitHub API the site itself saves with.

Rules, so it never fights with what was typed on the site:
  * nothing before SINCE is touched
  * a run:   one log entry per watch record, so a jog and the strides recorded after it stay apart. The
             longest is taken as the planned run and gets the plan's session name; another one is named
             after the watch's mode (track -> Interval run). An entry typed or checked off on the site is
             completed, never overwritten: only empty fields are filled.
             Only on a "체육관 왕복 러닝" day do the runs go into ONE entry (the way there and the way back),
             and the numbers this script wrote itself are updated when the second leg arrives.
  * a class: average / max heart rate are filled into the day's Hyrox entry, only when there is exactly
             one such entry and exactly one matching activity, and only where the entry has none
  * sleep:   bed, wake and the time between them, only for a day that has no sleep written yet
  * a day with a Race entry is left alone (warm-up, race and watch record are one entry there)
  * an entry moved to the trash keeps its link, so it is not created again

Test without Garmin or GitHub:  py tools/garmin_sync.py --local <copy of data/> --fixture <file.json> [--now ISO]
"""
import argparse
import base64
import copy
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = os.environ.get('GITHUB_REPOSITORY', 'Yang-Hyeonwoo/yang-hyeonwoo.github.io')
BRANCH = 'main'
TZ = ZoneInfo(os.environ.get('SITE_TZ', 'Asia/Seoul'))
SINCE = '2026-11-25'        # the day the sync was set up; older days stay as they were typed
LOOKBACK = 7                # days of activities read each time
SLEEP_DAYS = 3              # days of sleep looked at each time
KEEP_SEEN = 90              # days an activity id is remembered

# the same lists as assets/site.js
RUNS = ['Run commute', 'Jogging', 'Easy run', 'Tempo run', 'Interval run', 'Long run', 'Uphill training',
        'Recovery run', 'Time trial', 'Trail run', 'Run']
HYROX = ['Functional Training', 'Hyrox Double', 'Hyrox Single', 'Strength', 'Interval', 'Open Gym', 'Simulation',
         'Test', 'Hyrox Training']
NOT_A_CLASS = ('strength_training', 'walking', 'hiking', 'cycling', 'swimming', 'yoga', 'breathwork', 'pilates',
               'meditation', 'golf', 'multi_sport')


def type_key(a):
    return ((a.get('activityType') or {}).get('typeKey') or '').lower()


def is_run(a):
    k = type_key(a)
    return k == 'running' or k.endswith('_running') or k.endswith('_run')


def is_class(a):
    k = type_key(a)
    return not is_run(a) and not any(x in k for x in NOT_A_CLASS) and a.get('averageHR') and (a.get('duration') or 0) >= 600


def act_date(a):
    return (a.get('startTimeLocal') or '')[:10]


def aid(a):
    return str(a.get('activityId'))


def clock(seconds):
    s = int(round(seconds))
    return f'{s // 60}:{s % 60:02d}'


def num(v, places):
    v = round(v, places)
    return int(v) if v == int(v) and places == 0 else v


def run_fields(acts):
    """One set of numbers for a day's runs: distance, time, pace, heart rate."""
    dist = sum(a.get('distance') or 0 for a in acts)
    dur = sum(a.get('duration') or 0 for a in acts)
    f = {}
    if dist > 0:
        f['km'] = num(dist / 1000, 2)
    if dur > 0:
        f['minutes'] = num(dur / 60, 1)
    if dist > 0 and dur > 0:
        f['pace'] = clock(dur / (dist / 1000))
    hr = [(a['averageHR'], a.get('duration') or 1) for a in acts if a.get('averageHR')]
    if hr:
        f['avg_hr'] = int(round(sum(h * w for h, w in hr) / sum(w for _, w in hr)))
    mx = [a['maxHR'] for a in acts if a.get('maxHR')]
    if mx:
        f['max_hr'] = int(round(max(mx)))
    return f


def session_for(day):
    """The log session a planned run becomes: the same choice the site makes for its check button ('' = no run planned)."""
    for it in (day or {}).get('items', []):
        t = it.get('t', '')
        if it.get('k') == 'commute':
            return 'Run commute'
        if it.get('k') == 'run':
            return ('Time trial' if '기록 측정' in t else 'Jogging' if '조깅' in t and '세트' not in t
                    else 'Tempo run' if '연속' in t else 'Interval run')
    return ''


def session_by_type(a):
    """A run that is not the planned one is named after the watch's mode."""
    k = type_key(a)
    return 'Interval run' if k == 'track_running' else 'Trail run' if k == 'trail_running' else 'Run'


def linked_ids(log):
    return {str(i) for e in log for i in (e.get('garmin') or [])}


def empty(v):
    return v is None or v == ''


def fill(entry, fields):
    for k, v in fields.items():
        if empty(entry.get(k)):
            entry[k] = v


def merge_runs(log, plan_days, acts, seen):
    """Adds the watch's runs to the log. Returns the lines to report."""
    notes = []
    days = {}
    for a in sorted(acts, key=lambda x: x.get('startTimeLocal') or ''):
        if is_run(a) and act_date(a) >= SINCE:
            days.setdefault(act_date(a), []).append(a)
    done = linked_ids(log) | set(seen)
    for d, day in sorted(days.items()):
        entries = [e for e in log if e.get('date') == d and not e.get('deleted')]
        if any(e.get('session') == 'Race' for e in entries):
            continue
        new = [a for a in day if aid(a) not in done]
        if not new:
            continue
        ids = [aid(a) for a in new]
        runs = [e for e in entries if e.get('session') in RUNS]
        planned = session_for(plan_days.get(d))
        if planned == 'Run commute' or any(e.get('session') == 'Run commute' for e in runs):
            # the way to the gym and the way back are one entry
            pooled = next((e for e in runs if e.get('garmin')), None)
            prev = [a for a in day if aid(a) in {str(i) for i in (pooled or {}).get('garmin', [])}]
            mine = next((e for e in runs if not e.get('garmin')), None)
            if pooled and len(prev) == len(pooled['garmin']):
                # the second leg: add it, replacing only the numbers this script wrote
                was, now = run_fields(prev), run_fields(prev + new)
                for k, v in now.items():
                    if empty(pooled.get(k)) or pooled.get(k) == was.get(k):
                        pooled[k] = v
                pooled['garmin'] = [str(i) for i in pooled['garmin']] + ids
                notes.append(f'{d} run +{len(new)} -> {pooled.get("km")}km')
            elif mine:                                 # typed or checked off on the site: fill only what is empty
                fill(mine, run_fields(new))
                mine['garmin'] = ids
                notes.append(f'{d} run filled {mine.get("km")}km')
            else:
                f = run_fields(new)
                log.append({'id': 'g' + ids[0], 'date': d, 'session': 'Run commute', **f, 'garmin': ids})
                notes.append(f'{d} run new {f.get("km")}km')
        else:
            # any other day: one entry per watch record (a jog and the strides after it stay apart).
            # The longest goes first: it is the planned run, and the entry checked off on the site is meant for it.
            for a in sorted(new, key=lambda x: -(x.get('distance') or 0)):
                f = run_fields([a])
                free = [e for e in runs if not e.get('garmin')]
                with_km = [e for e in free if not empty(e.get('km'))]
                mine = (min(with_km, key=lambda e: abs(float(e['km']) - f.get('km', 0))) if with_km and len(with_km) == len(free)
                        else next((e for e in free if empty(e.get('km'))), None))
                if mine:
                    fill(mine, f)
                    mine['garmin'] = [aid(a)]
                    notes.append(f'{d} run filled {f.get("km")}km')
                else:
                    first = not any(e.get('garmin') for e in runs)
                    e = {'id': 'g' + aid(a), 'date': d, 'session': (planned if first and planned else session_by_type(a)), **f, 'garmin': [aid(a)]}
                    log.append(e)
                    runs.append(e)
                    notes.append(f'{d} run new {f.get("km")}km')
        for i in ids:
            seen[i] = d
    return notes


def merge_class_hr(log, acts, seen):
    """Heart rate for a Hyrox class, when there is no doubt which activity belongs to which entry."""
    notes = []
    days = {}
    for a in acts:
        if is_class(a) and act_date(a) >= SINCE:
            days.setdefault(act_date(a), []).append(a)
    for d, day in sorted(days.items()):
        entries = [e for e in log if e.get('date') == d and not e.get('deleted') and e.get('session') in HYROX]
        if len(day) != 1 or len(entries) != 1:
            continue
        a, e = day[0], entries[0]
        if e.get('garmin') or aid(a) in seen or aid(a) in linked_ids(log):
            continue
        filled = []
        for k, v in (('avg_hr', a.get('averageHR')), ('max_hr', a.get('maxHR'))):
            if v and empty(e.get(k)):
                e[k] = int(round(v))
                filled.append(k)
        e['garmin'] = [aid(a)]
        seen[aid(a)] = d
        if filled:
            notes.append(f'{d} class heart rate')
    return notes


def hm(dt):
    return f'{dt.hour}:{dt.minute:02d}'


def merge_sleep(daily, sleeps, now):
    """Bed and wake from the watch, for a day that has no sleep written yet."""
    notes = []
    for d, dto in sorted(sleeps.items()):
        st, en = (dto or {}).get('sleepStartTimestampGMT'), (dto or {}).get('sleepEndTimestampGMT')
        if d < SINCE or not st or not en or en - st < 2 * 3600 * 1000:
            continue
        if en / 1000 > now.timestamp() - 1800:          # woke up less than half an hour ago: the watch may still be adding to it
            continue
        row = next((r for r in daily if r.get('date') == d), None)
        if row and any(not empty(row.get(k)) for k in ('bed', 'wake', 'sleep')):
            continue
        bed = datetime.fromtimestamp(st / 1000, timezone.utc).astimezone(TZ)
        wake = datetime.fromtimestamp(en / 1000, timezone.utc).astimezone(TZ)
        span = ((wake.hour * 60 + wake.minute) - (bed.hour * 60 + bed.minute)) % 1440
        if not row:
            row = {'date': d}
            daily.append(row)
        row.update({'sleep': f'{span // 60}:{span % 60:02d}', 'bed': hm(bed), 'wake': hm(wake)})
        notes.append(f'{d} sleep {row["bed"]}-{row["wake"]}')
    daily.sort(key=lambda r: r.get('date', ''))
    return notes


def sleep_dates(daily, now):
    """The recent days that still have no sleep."""
    out = []
    for n in range(SLEEP_DAYS):
        d = (now.astimezone(TZ) - timedelta(days=n)).strftime('%Y-%m-%d')
        row = next((r for r in daily if r.get('date') == d), None)
        if d >= SINCE and not (row and any(not empty(row.get(k)) for k in ('bed', 'wake', 'sleep'))):
            out.append(d)
    return out


def prune(seen, now):
    cut = (now.astimezone(TZ) - timedelta(days=KEEP_SEEN)).strftime('%Y-%m-%d')
    return {k: v for k, v in seen.items() if v >= cut}


def text(data):
    return json.dumps(data, ensure_ascii=False, indent=1) + '\n'       # the same layout the site saves in


# ---------- where the data files live ----------
class Local:
    """A folder of copies, for trying things out."""
    def __init__(self, path, dry):
        self.path, self.dry = Path(path), dry

    def read(self, name, default=None):
        p = self.path / f'{name}.json'
        return (json.loads(p.read_text(encoding='utf-8')), None) if p.exists() else (copy.deepcopy(default), None)

    def write(self, name, data, sha, message):
        print(('would save ' if self.dry else 'save ') + f'{name}: {message}')
        if not self.dry:
            (self.path / f'{name}.json').write_text(text(data), encoding='utf-8', newline='\n')
        return True

    def publish(self):
        pass


class GitHub:
    def __init__(self, token, dry):
        self.token, self.dry = token, dry

    def call(self, method, path, body=None):
        req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/{path}', method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Authorization': f'Bearer {self.token}', 'Accept': 'application/vnd.github+json',
                                              'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'site-sync'})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def read(self, name, default=None):
        try:
            j = self.call('GET', f'contents/data/{name}.json?ref={BRANCH}')
        except urllib.error.HTTPError as e:
            if e.code == 404 and default is not None:
                return copy.deepcopy(default), None
            raise
        return json.loads(base64.b64decode(j['content']).decode('utf-8')), j['sha']

    def write(self, name, data, sha, message):
        if self.dry:
            print(f'would save {name}: {message}')
            return True
        body = {'message': message, 'branch': BRANCH, 'content': base64.b64encode(text(data).encode('utf-8')).decode()}
        if sha:
            body['sha'] = sha
        try:
            self.call('PUT', f'contents/data/{name}.json', body)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (409, 422):                   # the site saved in between: read again and redo
                return False
            raise

    def publish(self):
        """A commit made by Actions does not always rebuild the public pages, so ask for it."""
        if self.dry:
            return
        try:
            self.call('POST', 'pages/builds')
        except urllib.error.HTTPError as e:
            print(f'::warning::pages build not requested ({e.code})')


def update(store, name, change, default=None):
    """Read, change, save; again if someone else saved in between. change(data) returns the report lines."""
    for _ in range(4):
        data, sha = store.read(name, default)
        before = text(data)
        notes = change(data)
        if text(data) == before:
            return []
        if store.write(name, data, sha, 'garmin: ' + '; '.join(notes or ['state'])[:180]):
            return notes or ['state']
    raise RuntimeError(f'{name}: could not save after several tries')


# ---------- Garmin ----------
def garmin_login(tokens):
    from garminconnect import Garmin
    g = Garmin()
    g.login(tokens)
    return g


def keep_tokens(g, tokens, path):
    """Garmin may hand out a new refresh token when the old one is used. Keep the new one for the next run."""
    if g is None or g.client.di_refresh_token == json.loads(tokens).get('di_refresh_token'):
        return
    if path:
        Path(path).write_text(g.client.dumps(), encoding='utf-8')
        print('Garmin replaced the login tokens during this run; handing the new ones to the next step.')
    else:
        print('::warning::Garmin replaced the login tokens during this run and there is nowhere to keep the new ones.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--local', help='folder with copies of the data files, instead of GitHub')
    ap.add_argument('--fixture', help='JSON file {"activities": [...], "sleep": {date: dailySleepDTO}} instead of Garmin')
    ap.add_argument('--now', help='pretend it is this time (ISO), for tests')
    ap.add_argument('--dry', action='store_true', help='report only, save nothing')
    ap.add_argument('--tokens-out', help='write the tokens here when Garmin replaced them during this run')
    a = ap.parse_args()
    now = datetime.fromisoformat(a.now).astimezone(TZ) if a.now else datetime.now(TZ)
    tokens = os.environ.get('GARMINTOKENS', '').strip()
    if not a.fixture and not tokens:
        print('::notice::Garmin is not connected yet (no GARMIN_TOKENS secret). Run tools/garmin_login.py on the PC once.')
        return 0
    store = Local(a.local, a.dry) if a.local else GitHub(os.environ['GITHUB_TOKEN'], a.dry)
    state, _ = store.read('garmin', {})
    state.setdefault('seen', {})
    daily, _ = store.read('daily')
    start = max(SINCE, (now - timedelta(days=LOOKBACK)).strftime('%Y-%m-%d'))
    today = now.strftime('%Y-%m-%d')

    g = None
    if a.fixture:
        fx = json.loads(Path(a.fixture).read_text(encoding='utf-8'))
        acts, sleeps = fx.get('activities', []), {d: fx.get('sleep', {}).get(d) for d in sleep_dates(daily, now)}
    else:
        from garminconnect import GarminConnectAuthenticationError
        try:
            g = garmin_login(tokens)
            keep_tokens(g, tokens, a.tokens_out)       # straight away, in case anything below fails
            acts = g.get_activities_by_date(start, today)
            sleeps = {d: (g.get_sleep_data(d) or {}).get('dailySleepDTO') for d in sleep_dates(daily, now)}
        except GarminConnectAuthenticationError as e:
            # say it once (a failed run sends a mail), then stay quiet until someone logs in again; the site shows a note meanwhile
            first = state.get('error') != 'auth'
            if first:
                update(store, 'garmin', lambda s: (s.update({'error': 'auth', 'error_at': now.isoformat(timespec='minutes')}), ['login expired'])[1], {})
                store.publish()
            print(f'::error::Garmin login is no longer valid ({type(e).__name__}). Run tools/garmin_login.py on the PC again.')
            return 1 if first else 0

    plan, _ = store.read('plan')
    seen = dict(state['seen'])
    out = []

    def log_change(log):
        seen.clear()
        seen.update(state['seen'])                    # start again from the stored state on every retry
        return merge_runs(log, plan.get('days', {}), acts, seen) + merge_class_hr(log, acts, seen)

    out += update(store, 'log', log_change)
    out += update(store, 'daily', lambda d: merge_sleep(d, sleeps, now))

    def state_change(s):
        s.setdefault('seen', {}).update(seen)
        s['seen'] = prune(s['seen'], now)
        had = s.pop('error', None)
        s.pop('error_at', None)
        return ['connected again'] if had else []

    out += update(store, 'garmin', state_change, {})
    if out:
        store.publish()
    print(f'{len(acts)} activities since {start}; ' + ('; '.join(out) if out else 'nothing new'))

    keep_tokens(g, tokens, a.tokens_out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
