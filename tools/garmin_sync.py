"""Garmin Connect -> the site's data files (runs, class heart rate, sleep).

Runs on GitHub Actions (.github/workflows/garmin.yml) every hour. It reads the watch's records and adds
them to data/log.json and data/daily.json through the same GitHub API the site itself saves with.

Rules, so it never fights with what was typed on the site:
  * nothing before SINCE is touched
  * a run:   ONE log entry per day. Its top numbers are the day's totals (distance, time, heart rate);
             when the watch has more than one record that day, each gets its own line in the workout text
             ("조깅 8.0km · 6:21/km"), and no overall pace is written, since it would mix a jog with sprints.
             Intervals (laps alternating fast and slow) are written the way the user writes them:
             200/200(39"/98") × 4 · 3:15/8:10  (rep / recovery distance, average seconds, then the paces).
             An entry typed or checked off on the site is completed, never overwritten: only empty fields
             are filled. What this script wrote itself is updated when a later record of the day arrives.
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
    """A run nobody planned is named after the watch's mode."""
    k = type_key(a)
    return 'Interval run' if k == 'track_running' else 'Trail run' if k == 'trail_running' else 'Run'


def linked_ids(log):
    return {str(i) for e in log for i in (e.get('garmin') or [])}


def empty(v):
    return v is None or v == ''


# ---------- intervals, written the way the user writes them: 200/200(60"/100") × 4 · 5:00/8:20 ----------
def nominal(m):
    step = 50 if m < 1000 else 100
    return int(round(m / step) * step)


def secs(s):
    s = int(round(s))
    return f'{s}"' if s < 120 else f"{s // 60}'{s % 60:02d}\""


def per_km(dist_m, dur_s):
    return clock(dur_s / (dist_m / 1000))


def mean(xs):
    return sum(xs) / len(xs)


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if len(xs) % 2 else (xs[len(xs) // 2 - 1] + xs[len(xs) // 2]) / 2


def interval_text(laps):
    """The interval line, when the laps alternate fast and slow (the user presses lap, or the track mode does); else None."""
    L = [lap for lap in laps if (lap.get('duration') or 0) > 0]
    if len(L) < 3:
        return None
    sp = [(lap.get('distance') or 0) / lap['duration'] for lap in L]
    hi, lo = max(sp), min(sp)
    if hi <= 0 or hi < 1.3 * lo:                       # ordinary auto laps of a steady run (a jog's kms differ by ~15%)
        return None
    fast = [s >= (hi + lo) / 2 for s in sp]
    a = b = 0                                          # the longest fast/slow/fast... stretch that starts fast
    i = 0
    while i < len(L):
        if fast[i]:
            j = i + 1
            while j < len(L) and fast[j] != fast[j - 1]:
                j += 1
            if j - i > b - a:
                a, b = i, j
            i = j
        else:
            i += 1
    F = [L[k] for k in range(a, b) if fast[k]]
    S = [L[k] for k in range(a, b) if not fast[k]]
    if len(F) < 2 or not S:
        return None
    same = lambda group, d: all(abs((x.get('distance') or 0) - d) <= max(30, 0.15 * d) for x in group)
    fd = nominal(median([x.get('distance') or 0 for x in F]))
    if fd <= 0 or not same(F, fd):
        return None
    ft = round(mean([x['duration'] for x in F]))      # the shown seconds and the shown pace agree with each other
    st = round(mean([x['duration'] for x in S]))
    if all((x.get('distance') or 0) < 50 for x in S):  # standing rest
        core = f'{fd}({secs(ft)}) × {len(F)} · 휴식 {secs(st)} · {per_km(fd, ft)}'
    else:
        sd = nominal(median([x.get('distance') or 0 for x in S]))
        if sd <= 0 or not same(S, sd):
            return None
        core = f'{fd}/{sd}({secs(ft)}/{secs(st)}) × {len(F)} · {per_km(fd, ft)}/{per_km(sd, st)}'
    out = []
    before = L[:a]
    if sum(x.get('distance') or 0 for x in before) >= 100:
        d, t = sum(x.get('distance') or 0 for x in before), sum(x['duration'] for x in before)
        out.append(f'러닝 {d / 1000:.1f}km · {per_km(d, t)}/km' if d >= 3000 else f'워밍업 {d / 1000:.1f}km')
    out.append(core)
    after = L[b:]
    if sum(x.get('distance') or 0 for x in after) >= 100:
        out.append(f'쿨다운 {sum(x.get("distance") or 0 for x in after) / 1000:.1f}km')
    return ' + '.join(out)


def day_fields(acts, laps_of, planned):
    """A day's runs as one entry: totals at the top, and a line per watch record when there is more than one
    (or when it was intervals). The pace at the top would mix a jog with sprints, so it is left out then."""
    f = run_fields(acts)
    iv = {aid(a): interval_text(laps_of(a)) for a in acts}
    if len(acts) == 1 and not iv[aid(acts[0])]:
        return f
    f.pop('pace', None)
    longest = max(acts, key=lambda x: x.get('distance') or 0)
    lines, legs = [], 0
    for a in acts:
        if iv[aid(a)]:
            lines.append(iv[aid(a)])
            continue
        d, t = a.get('distance') or 0, a.get('duration') or 0
        if planned == 'Run commute':
            label = ('갈 때', '올 때')[legs] if legs < 2 else '러닝'
        elif a is longest and planned == 'Jogging':
            label = '조깅'
        else:
            label = '트레일' if type_key(a) == 'trail_running' else '러닝'
        legs += 1
        lines.append(f'{label} {d / 1000:.1f}km · {per_km(d, t)}/km' if d > 0 and t > 0 else label)
    f['workout'] = '\n'.join(lines)
    return f


def merge_runs(log, plan_days, acts, seen, laps_of):
    """Adds the watch's runs to the log: ONE entry per day, every record of the day written into it.
    Returns the lines to report."""
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
        if not planned and any(e.get('session') == 'Run commute' for e in runs):
            planned = 'Run commute'
        pooled = next((e for e in runs if e.get('garmin')), None)
        if pooled:
            # another record of a day the sync has written before: replace only what the sync itself wrote
            had = {str(i) for i in pooled['garmin']}
            prev = [a for a in day if aid(a) in had]
            was = day_fields(prev, laps_of, planned) if len(prev) == len(had) else {}
            now = day_fields(prev + new, laps_of, planned)
            for k in set(was) | set(now):
                if empty(pooled.get(k)) or pooled.get(k) == was.get(k):
                    if k in now:
                        pooled[k] = now[k]
                    else:
                        pooled.pop(k, None)
            pooled['garmin'] = [str(i) for i in pooled['garmin']] + ids
            notes.append(f'{d} run +{len(new)} -> {pooled.get("km")}km')
        else:
            f = day_fields(new, laps_of, planned)
            free = [e for e in runs if not e.get('garmin')]
            mine = next((e for e in free if e.get('session') == planned), None) or (free[0] if free else None)
            if mine:                                   # typed or checked off on the site: fill only what is empty
                for k, v in f.items():
                    if empty(mine.get(k)):
                        mine[k] = v
                mine['garmin'] = ids
                notes.append(f'{d} run filled {mine.get("km")}km')
            else:
                longest = max(new, key=lambda x: x.get('distance') or 0)
                log.append({'id': 'g' + ids[0], 'date': d, 'session': planned or session_by_type(longest), **f, 'garmin': ids})
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


def inspect(g, d):
    """Only training numbers are printed (the log is public): no names, places or GPS."""
    for a in g.get_activities_by_date(d, d):
        print('activity', type_key(a), 'dist', a.get('distance'), 'dur', a.get('duration'))
        laps = (g.get_activity_splits(aid(a)) or {}).get('lapDTOs') or []
        if laps:
            print('  lap keys:', sorted(k for k in laps[0] if not any(x in k.lower() for x in ('lat', 'lon', 'name'))))
        for l in laps:
            print('  lap', l.get('lapIndex'), 'dist', l.get('distance'), 'dur', l.get('duration'), 'mov', l.get('movingDuration'),
                  'spd', l.get('averageSpeed'), 'hr', l.get('averageHR'), 'int', l.get('intensityType'), 'trig', l.get('lapTrigger') or l.get('triggerMethod'))
        try:
            ts = g.get_activity_typed_splits(aid(a)) or {}
            for s in (ts.get('splits') or [])[:30]:
                print('  typed', s.get('type'), 'dist', s.get('distance'), 'dur', s.get('duration'), 'spd', s.get('averageSpeed'))
        except Exception as e:
            print('  typed splits:', type(e).__name__)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--local', help='folder with copies of the data files, instead of GitHub')
    ap.add_argument('--fixture', help='JSON file {"activities": [... each may carry "laps"], "sleep": {date: dailySleepDTO}} instead of Garmin')
    ap.add_argument('--now', help='pretend it is this time (ISO), for tests')
    ap.add_argument('--dry', action='store_true', help='report only, save nothing')
    ap.add_argument('--inspect', help='print the laps of the runs on this date (YYYY-MM-DD) and stop; for working out new rules')
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
        laps_of = lambda x: x.get('laps') or []
    else:
        from garminconnect import GarminConnectAuthenticationError
        try:
            g = garmin_login(tokens)
            keep_tokens(g, tokens, a.tokens_out)       # straight away, in case anything below fails
            if a.inspect:
                inspect(g, a.inspect)
                return 0
            acts = g.get_activities_by_date(start, today)
            cache = {}

            def laps_of(x):                            # read only for days with a new run
                if aid(x) not in cache:
                    cache[aid(x)] = (g.get_activity_splits(aid(x)) or {}).get('lapDTOs') or []
                return cache[aid(x)]
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
        return merge_runs(log, plan.get('days', {}), acts, seen, laps_of) + merge_class_hr(log, acts, seen)

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
