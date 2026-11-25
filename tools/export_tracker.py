"""One-time migration: Life Tracker workbook -> site data files.

Usage:  python export_tracker.py <path-to-workbook.xlsx> <site-data-dir>

Only the sheets in ALLOWED are ever opened. Finance, Household account and
Future authoring are never read, and the workbook itself is never copied.

daily.json  one row per day: sleep, body weight, nutrition
log.json    every training session, in three kinds the site charts by:
            Hyrox (classes, races), Running, Weight (plus a few "Cardio" extras)
"""
import datetime as dt
import json
import re
import sys
import warnings

import openpyxl

ALLOWED = {"Overall tracker", "Hyrox training", "Running", "Weight training"}
warnings.simplefilter("ignore")
src, out_dir = sys.argv[1], sys.argv[2].rstrip("/\\")
wb = openpyxl.load_workbook(src, data_only=True, read_only=True)


def sheet(name):
    assert name in ALLOWED, "sheet not allowed: " + name
    return wb[name]


def blank(v):
    return v is None or (isinstance(v, str) and v.strip() in ("", "-", "."))


def num(v, nd=None):
    if blank(v) or isinstance(v, (dt.time, dt.datetime, dt.timedelta)):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        m = re.search(r"\d+(\.\d+)?", str(v))
        if not m:
            return None
        f = float(m.group(0))
    if nd is None:
        return int(f) if f == int(f) else round(f, 2)
    return round(f, nd)


def hhmm(v):
    """Clock value or duration -> 'H:MM'."""
    if isinstance(v, dt.datetime):
        v = v.time()
    if isinstance(v, dt.time):
        return "%d:%02d" % (v.hour, v.minute)
    if isinstance(v, dt.timedelta):
        m = int(round(v.total_seconds() / 60))
        return "%d:%02d" % (m // 60, m % 60)
    return None


def text(v):
    return None if blank(v) else str(v).strip()


def iso(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def g(v):
    """Number without a trailing .0"""
    return ("%g" % v) if isinstance(v, (int, float)) else str(v).strip()


# ---- daily: sleep, body weight, nutrition (+ what the old sheet noted as that day's training) ----
daily, weight_days, cardio_notes = [], [], {}
for r in sheet("Overall tracker").iter_rows(min_row=4, max_col=13, values_only=True):
    d = iso(r[1])
    if not d:
        continue
    split, cardio = text(r[6]), text(r[7])
    if split and split.lower() != "rest":
        weight_days.append((d, split))
    if cardio:
        cardio_notes[d] = cardio
    row = {
        "date": d,
        "sleep": hhmm(r[3]), "bed": hhmm(r[4]), "wake": hhmm(r[5]),
        "weight": num(r[8], 2), "kcal": num(r[9], 0),
        "carb": num(r[10], 0), "prot": num(r[11], 0), "fat": num(r[12], 0),
    }
    for k in ("kcal", "carb", "prot", "fat"):
        if row[k] is not None:
            row[k] = int(row[k])
    if any(v is not None for k, v in row.items() if k != "date"):
        daily.append({k: v for k, v in row.items() if v is not None})

# ---- Hyrox sessions written up in detail ------------------------------------
log = []
for r in sheet("Hyrox training").iter_rows(min_row=4, max_col=16, values_only=True):
    d = iso(r[2])
    if not d or blank(r[4]):
        continue
    e = {
        "date": d, "session": text(r[4]), "format": text(r[5]), "minutes": num(r[6]),
        "workout": text(r[7]), "notes": text(r[8]), "result": text(r[9]),
        "rpe": num(r[10]), "avg_hr": num(r[11]), "max_hr": num(r[12]),
    }
    log.append({k: v for k, v in e.items() if v is not None})
hyrox_dates = {e["date"] for e in log}


# ---- runs ---------------------------------------------------------------------
def pace(v):
    """The sheet stores min:sec per km as a clock value (5:36:00 means 5:36/km)."""
    if isinstance(v, dt.time):
        return "%d:%02d" % (v.hour, v.minute)
    return None


# A few words on how each run went, condensed from the sheet's own notes (date|km -> brief).
RUN_BRIEF = {
    "2026-05-17|8": "6개월 만의 러닝, 숨찼지만 완주",
    "2026-05-21|8": "조깅 7km + 마지막 1km 질주, 몸 가벼움",
    "2026-05-24|3.2": "200m 인터벌 4세트, 하체 운동 뒤라 쥐",
    "2026-05-25|8": "다리 피로 속 조깅, 버겁지만 가능",
    "2026-05-29|7.58": "5.5km 5:25 + 400m 질주",
    "2026-06-07|6": "5:00 지속주, 쥐가 나서 세 번 쉼",
    "2026-06-23|8.8": "2000m(4:55) 인터벌 3세트 + 조깅 2km",
    "2026-07-07|5": "카이스트 한 바퀴, 오랜만이라 몸 무거움",
    "2026-07-08|4.72": "카이스트 한 바퀴, 어제보다 가벼움",
    "2026-07-10|5.11": "카이스트 한 바퀴, 속도 올려 조깅",
    "2026-07-21|4.76": "카이스트 한 바퀴",
    "2026-07-23|5.5": "카이스트 한 바퀴",
    "2026-08-05|4.73": "카이스트 한 바퀴, 더위",
    "2026-08-09|6": "갑천, 더위",
    "2026-08-17|7": "갑천",
    "2026-08-26|8": "갑천",
    "2026-09-15|0.87": "Hyrox Training 중 러닝",
    "2026-09-24|8.1": "홍대 시티런",
    "2026-09-26|12.51": "남산 2회전, 오랜만이라 힘듦",
    "2026-10-02|7.35": "카이스트 두 바퀴, 시원해져 잘 뛰어짐",
    "2026-10-03|8.8": "카이스트 두 바퀴, 조깅하기 좋은 날",
    "2026-10-05|5.01": "카이스트 한 바퀴",
    "2026-10-09|12.39": "엑스포 조깅",
    "2026-10-11|7.19": "800m(4:50) 인터벌 6세트",
    "2026-10-15|4.72": "카이스트 한 바퀴",
    "2026-10-22|8.27": "집 근처, 편안한 조깅",
    "2026-11-22|1.02": "한강 런짐 대회",
    "2026-11-22|6.59": "한강 런짐 대회",
}

run_dates, run_km = set(), {}
for r in sheet("Running").iter_rows(min_row=3, max_col=17, values_only=True):
    d = iso(r[2])
    dist = num(r[5], 2)
    if not d or dist is None:
        continue
    minutes = None
    if isinstance(r[7], dt.timedelta):
        minutes = round(r[7].total_seconds() / 60, 1)
    elif isinstance(r[7], dt.time):
        minutes = round(r[7].hour * 60 + r[7].minute + r[7].second / 60, 1)
    kind = text(r[4]) or "Run"
    kind = {"Interval training": "Interval run", "Steady run": "Easy run"}.get(kind, kind)
    e = {
        "date": d, "session": kind, "km": dist, "pace": pace(r[6]), "minutes": minutes,
        "avg_hr": num(r[8]), "max_hr": num(r[9]), "rpe": num(r[10]),
        "workout": text(r[11]), "notes": text(r[16]), "shoes": text(r[15]),
        "brief": RUN_BRIEF.get("%s|%s" % (d, g(dist))),
    }
    log.append({k: v for k, v in e.items() if v is not None})
    run_dates.add(d)
    run_km.setdefault(d, []).append(dist)

# ---- weights: one block of rows per session --------------------------------------
# The Overall tracker is the truth for WHICH days were weight days and which split was trained.
# The Weight training sheet holds the sets, one block per session, but its early blocks carry no date and
# its later dates are often the planned day, not the day it was done. So each block that has reps written
# in is aligned, in order, to a tracker day with the same split (same date preferred, a few days' slack
# allowed). A day whose details were matched this way rather than by exact date is marked "approx".
def day_of(s):
    return dt.date.fromisoformat(s)


blocks, cur = [], None
for r in sheet("Weight training").iter_rows(min_row=4, max_col=16, values_only=True):
    if r[2] == "Train":
        cur = {"date": iso(r[1]), "rows": []}
        blocks.append(cur)
    elif cur is not None and not blank(r[2]) and not blank(r[3]):
        cur["rows"].append(r)
for b in blocks:
    lifts = [r for r in b["rows"] if text(r[2]) not in ("Cardio", "Abs")]
    b["split"] = text(lifts[0][2]) if lifts else None
    b["sets"] = sum(1 for r in lifts for v in r[8:13] if not blank(v))
blocks = [b for b in blocks if b["split"] and b["sets"]]
first_dated = min(b["date"] for b in blocks if b["date"])


def fit(b, d, split):
    """Score for putting block b on tracker day d, or None if it cannot be that day."""
    if b["split"] != split:
        return None
    if b["date"] is None:
        return 1.0 if d < first_dated else None
    gap = abs((day_of(b["date"]) - day_of(d)).days)
    return 3.0 if gap == 0 else (1.5 - gap * 0.1 if gap <= 4 else None)


m, n = len(blocks), len(weight_days)
best = [[0.0] * (n + 1) for _ in range(m + 1)]
for i in range(1, m + 1):
    for j in range(1, n + 1):
        s = fit(blocks[i - 1], *weight_days[j - 1])
        best[i][j] = max(best[i - 1][j], best[i][j - 1], best[i - 1][j - 1] + s if s is not None else 0.0)
matched, i, j = {}, m, n
while i and j:
    s = fit(blocks[i - 1], *weight_days[j - 1])
    if s is not None and best[i][j] == best[i - 1][j - 1] + s:
        matched[j - 1] = blocks[i - 1]
        i, j = i - 1, j - 1
    elif best[i][j] == best[i - 1][j]:
        i -= 1
    else:
        j -= 1

weights_cardio_dates, exact = set(), 0
for j, (d, split) in enumerate(weight_days):
    e = {"date": d, "session": "Weight Training", "format": split}
    b = matched.get(j)
    if b:
        lines, memos = [], []
        for r in b["rows"]:
            ex = text(r[3])
            if text(r[2]) == "Cardio":
                continue                      # cardio after lifting is taken from the tracker's own note for that day
            w = r[5]
            load = "" if blank(w) else ("맨몸" if str(w).strip() in ("Body", "BW") else (g(w) + "kg" if isinstance(w, (int, float)) else g(w)))
            reps = [g(v) for v in r[8:13] if not blank(v)]
            if reps:
                lines.append("%s · %s × %s" % (ex, load, ", ".join(reps)) if load else "%s · %s" % (ex, ", ".join(reps)))
            if reps and text(r[15]):          # a memo on an exercise that was skipped that day is a plan note, not a record
                memos.append("%s: %s" % (ex, text(r[15])))
        e["workout"] = "\n".join(lines)
        if memos:
            e["notes"] = "\n".join(memos)
        if b["date"] == d:
            exact += 1
        else:
            e["approx"] = True
    log.append(e)
print("weights: %d days, %d with sets (%d on the exact date, %d placed by order), %d without sets, %d blocks unused"
      % (n, len(matched), exact, len(matched) - exact, n - len(matched), m - len(matched)))

# ---- sessions the old sheet only noted in one cell --------------------------------
for d, note in sorted(cardio_notes.items()):
    low = note.lower()
    if re.search(r"hyrox|crossfit|hangang", low):
        if d not in hyrox_dates:
            log.append({"date": d, "session": "Race" if "race" in low else "Hyrox Training", "workout": note})
    elif re.search(r"run|jog|interval|sprint", low):
        if d not in run_dates:
            e = {"date": d, "session": "Run", "workout": note}
            m = re.search(r"(\d+(?:\.\d+)?)\s*km", low)
            if m:
                e["km"] = float(m.group(1))
                # The two sheets sometimes put the same run on neighbouring days. If the Running sheet has a run
                # of the same distance the day before or after, it is that run: keep the detailed one only.
                near = [(dt.date.fromisoformat(d) + dt.timedelta(days=k)).isoformat() for k in (-1, 1)]
                if any(abs(v - e["km"]) < 0.3 for nd in near for v in run_km.get(nd, [])):
                    continue
            log.append(e)
    else:
        log.append({"date": d, "session": "Cardio", "workout": note})

log.sort(key=lambda e: e["date"])
for i, e in enumerate(log, 1):
    e["id"] = "m%04d" % i


def dump(name, obj):
    path = "%s/%s" % (out_dir, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print(name, len(obj), "rows")


dump("daily.json", daily)
dump("log.json", log)
