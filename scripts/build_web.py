"""Assemble web/index.html from the head, the JS parts and the exported data.

The demo is deliberately a single self-contained file: it must run with no
server, no build step and no network access.
"""
import os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
WEB = os.path.join(ROOT, 'web')
PARTS = ['01-core.js', '02-narrate.js', '03-ui.js']
OUT = os.path.join(WEB, 'index.html')
DATA = os.path.join(WEB, 'venue_web.json')

if not os.path.exists(DATA):
    raise SystemExit('web/venue_web.json is missing. Run:\n'
                     '    python3 scripts/export_web.py')

head = open(os.path.join(WEB, 'index.head.html')).read()
js = ''.join(open(os.path.join(WEB, p)).read() for p in PARTS)
if '__VENUE_DATA__' not in js:
    raise SystemExit('01-core.js no longer contains the __VENUE_DATA__ placeholder.')
js = js.replace('__VENUE_DATA__', open(DATA).read())

open(OUT, 'w').write(head + '\n<script>\n' + js + '\n</script>\n')
print(f'web/index.html  {round(os.path.getsize(OUT)/1024)} KB')
