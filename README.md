# yang-hyeonwoo.github.io

Personal site: Research (links to Why Ions Compute) and Training (plan, log, daily records).

- `data/*.json` holds every record the pages show. The pages write to these files through the GitHub contents API.
- `tools/build_plan.py` regenerates `data/plan.json`. `tools/export_tracker.py` was the one-time import from the old spreadsheet.
- `tools/garmin_sync.py` runs every hour on GitHub Actions (`.github/workflows/garmin.yml`) and adds the watch's runs, class heart rate and sleep to the data files; its rules are at the top of the file. `tools/garmin_login.py` connects it to Garmin, once, from the PC.
- Plain HTML, CSS and JavaScript. No build step.
