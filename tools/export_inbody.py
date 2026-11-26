"""InBody measurements from the Life Tracker workbook -> data/inbody.json (merged, never shrinks).

Usage:  python export_inbody.py <path-to-workbook.xlsx> <site-data-dir>

Reads two blocks of the workbook and nothing else:
  * "Settings" AT:AY — every measurement since 2018 from the InBody app export (date, device, weight,
    skeletal muscle, fat mass, fat %)
  * "Overall tracker" W:AK — the InBody 970 sheets in full (BMI, visceral fat, score, BMR, body water,
    protein, minerals, ECW ratio, SMI, waist)
Rows are matched by date. A row already in inbody.json is kept, and the workbook only fills fields it
does not have yet, so measurements added later on the site or by hand (with phase angle, segmental lean
and so on) survive a re-run. No names, member numbers or clinic details are read.
"""
import datetime as dt
import json
import os
import sys
import warnings

import openpyxl

warnings.simplefilter("ignore")
src, out_dir = sys.argv[1], sys.argv[2].rstrip("/\\")
path = out_dir + "/inbody.json"
wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
day = lambda v: v.date().isoformat() if isinstance(v, dt.datetime) else None

found = {}
for r in wb["Settings"].iter_rows(min_row=2, max_row=400, min_col=46, max_col=51, values_only=True):   # AT..AY
    d, device, weight, muscle, fat, pct = r
    if day(d) and all(num(v) for v in (weight, muscle, fat, pct)):
        row = {"date": day(d), "weight": weight, "muscle": muscle, "fat": fat, "fat_pct": pct}
        if str(device) in ("270", "970"):
            row["device"] = str(device)
        found[row["date"]] = row                     # a later measurement on the same day wins
KEYS = ["weight", "muscle", "fat", "fat_pct", "bmi", "vfa", "score", "bmr", "tbw", "protein", "mineral", "ecw_ratio", "smi", "waist"]
for r in wb["Overall tracker"].iter_rows(min_row=3, max_row=60, min_col=23, max_col=37, values_only=True):   # W..AK
    if not day(r[0]):
        continue
    row = found.setdefault(day(r[0]), {"date": day(r[0])})
    row["device"] = "970"
    for k, v in zip(KEYS, r[1:]):
        if num(v):
            row[k] = v

rows = {x["date"]: x for x in json.load(open(path, encoding="utf-8"))} if os.path.exists(path) else {}
for d, row in found.items():
    have = rows.setdefault(d, {"date": d})
    for k, v in row.items():
        have.setdefault(k, v)
out = sorted(rows.values(), key=lambda x: x["date"])
with open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("inbody.json", len(out), "rows,", sum(1 for x in out if x.get("score")), "with the full InBody 970 sheet")
