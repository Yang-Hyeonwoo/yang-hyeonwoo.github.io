"""Adds a "← Main" button to every page of the Research site (Why Ions Compute), pointing at the hub.

Usage:  python add_main_link.py <checkout-of-why-ions-compute>

The Research repo holds built Quarto pages, so the button is inserted into each page's menu bar and its
style is appended to assets/apple.css. Safe to run twice. Run it only once the hub is published,
otherwise the button leads to a page that does not exist yet. If the site is ever re-rendered from its
Quarto source, run this again afterwards (or add the same link to the navbar in _quarto.yml).
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
HUB = "https://yang-hyeonwoo.github.io/"
LINK = '<a class="main-link" href="%s">← Main</a>' % HUB
ANCHOR = '<div class="quarto-navbar-tools">'
CSS = """
/* back to the hub (added by add_main_link.py) */
.main-link { display: inline-flex; align-items: center; margin-left: 12px; padding: 0.3rem 0.85rem; border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 980px; color: #6e6e73 !important; font-size: 0.84rem; font-weight: 500; white-space: nowrap; text-decoration: none !important; }
.main-link:hover { color: #111827 !important; border-color: rgba(0, 0, 0, 0.2); }
"""

done = skipped = missing = 0
for page in root.rglob("*.html"):
    if "site_libs" in page.parts:
        continue
    html = page.read_text(encoding="utf-8")
    if 'class="main-link"' in html:
        skipped += 1
    elif ANCHOR in html:
        page.write_text(html.replace(ANCHOR, ANCHOR + LINK, 1), encoding="utf-8", newline="\n")
        done += 1
    else:
        missing += 1
        print("no menu bar:", page.relative_to(root))
css = root / "assets" / "apple.css"
text = css.read_text(encoding="utf-8")
if ".main-link" not in text:
    css.write_text(text.rstrip("\n") + "\n" + CSS, encoding="utf-8", newline="\n")
print("button added to %d pages, already there on %d, no menu bar on %d" % (done, skipped, missing))
