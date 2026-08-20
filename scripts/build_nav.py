"""Assemble web/navigate.html: the turn-by-turn view.

Same contract as build_web.py — one self-contained file, no server, no network.
It reuses the engine parts verbatim so the steps shown here are the steps the
narrator produced, not a second implementation of them.
"""
import base64, io, os

ROOT = os.path.join(os.path.dirname(__file__), '..')
WEB = os.path.join(ROOT, 'web')
PARTS = ['01-core.js', '02-narrate.js', '04-facing.js', '05-nav.js']
OUT = os.path.join(WEB, 'navigate.html')
DATA = os.path.join(WEB, 'venue_web.json')

if not os.path.exists(DATA):
    raise SystemExit('web/venue_web.json is missing. Run:\n'
                     '    python3 scripts/export_web.py')

head = io.open(os.path.join(WEB, 'navigate.head.html'), encoding='utf-8').read()

# Inline the webfont rather than linking a CDN: the page must render correctly
# with no network, and a missing brand typeface is a visible failure.
FONT = os.path.join(WEB, 'lexend-deca-latin.woff2')
if '__FONT_LEXEND__' in head:
    if not os.path.exists(FONT):
        raise SystemExit('web/lexend-deca-latin.woff2 is missing; navigate.head.html needs it.')
    head = head.replace('__FONT_LEXEND__',
                        base64.b64encode(open(FONT, 'rb').read()).decode('ascii'))
js = ''.join(io.open(os.path.join(WEB, p), encoding='utf-8').read() for p in PARTS)
if '__VENUE_DATA__' not in js:
    raise SystemExit('01-core.js no longer contains the __VENUE_DATA__ placeholder.')
js = js.replace('__VENUE_DATA__', io.open(DATA, encoding='utf-8').read())

io.open(OUT, 'w', encoding='utf-8').write(head + '\n<script>\n' + js + '\n</script>\n')
print(f'web/navigate.html  {round(os.path.getsize(OUT)/1024)} KB')
