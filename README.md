# yang-hyeonwoo.github.io

Personal site: Research (links to Why Ions Compute) and Training (plan, log, daily records).

- `data/*.json` holds every record the pages show. The pages write to these files through the GitHub contents API.
- `tools/build_plan.py` regenerates `data/plan.json`. `tools/export_tracker.py` was the one-time import from the old spreadsheet.
- Plain HTML, CSS and JavaScript. No build step.
