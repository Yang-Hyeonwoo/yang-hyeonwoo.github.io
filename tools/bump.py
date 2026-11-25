"""Give the site a new version label, so browsers fetch the new files and open tabs reload themselves.

Usage:  python bump.py <site-dir> <label>      e.g.  python bump.py . 1127a
Changes the ?v= on site.css / site.js in every page, VERSION in assets/site.js, and version.txt.
"""
import pathlib
import re
import sys

root, label = pathlib.Path(sys.argv[1]), sys.argv[2]
assert re.fullmatch(r"[0-9a-z]+", label), "label: digits and lowercase letters only"
pages = [root / "index.html", *sorted((root / "training").glob("*.html"))]
for page in pages:
    html = page.read_text(encoding="utf-8")
    new, n = re.subn(r"(assets/site\.(?:css|js))\?v=[0-9a-z]+", r"\1?v=" + label, html)
    assert n == 2, (page, n)
    page.write_text(new, encoding="utf-8", newline="\n")
js = root / "assets" / "site.js"
text, n = re.subn(r"const VERSION = '[0-9a-z]+';", "const VERSION = '%s';" % label, js.read_text(encoding="utf-8"))
assert n == 1
js.write_text(text, encoding="utf-8", newline="\n")
(root / "version.txt").write_text(label + "\n", encoding="utf-8", newline="\n")
print("version", label, "on", len(pages), "pages")
