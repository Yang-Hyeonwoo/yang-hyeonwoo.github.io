"""InBody measurements from the Life Tracker workbook -> data/inbody.json

Usage:  python export_inbody.py <path-to-workbook.xlsx> <site-data-dir>

Reads only the InBody block of the "Overall tracker" sheet (columns W to AA). It writes its own file
and touches nothing else, so it is safe to run again after a new measurement is added to the sheet.
"""
import datetime as dt
import json
import sys
import warnings

import openpyxl

warnings.simplefilter("ignore")
src, out_dir = sys.argv[1], sys.argv[2].rstrip("/\\")
ws = openpyxl.load_workbook(src, data_only=True, read_only=True)["Overall tracker"]
rows = []
for r in ws.iter_rows(min_row=3, max_row=60, min_col=23, max_col=27, values_only=True):   # W..AA
    date, weight, muscle, fat, fat_pct = r
    if isinstance(date, dt.datetime) and all(isinstance(v, (int, float)) for v in (weight, muscle, fat, fat_pct)):
        rows.append({"date": date.date().isoformat(), "weight": weight, "muscle": muscle, "fat": fat, "fat_pct": fat_pct})
rows.sort(key=lambda x: x["date"])
with open(out_dir + "/inbody.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)
print("inbody.json", len(rows), "rows")
