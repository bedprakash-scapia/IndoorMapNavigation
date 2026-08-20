"""Assemble web/mall/index.html: the image-derived mall navigator, one file."""
import os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
WEB = os.path.join(ROOT, 'web', 'mall')
DATA = os.path.join(ROOT, 'venues', 'mall', 'mall_multi.json')
OUT = os.path.join(WEB, 'index.html')

if not os.path.exists(DATA):
    raise SystemExit('venues/mall/mall_multi.json missing. Run:\n'
                     '    python3 -m imagemaps.build_multi')

head = open(os.path.join(WEB, 'index.head.html')).read()
js = open(os.path.join(WEB, 'app.js')).read()
if '__MALL_DATA__' not in js:
    raise SystemExit('web/mall/app.js no longer contains the __MALL_DATA__ placeholder.')
open(OUT, 'w').write(head + '\n<script>\n' + js.replace('__MALL_DATA__', open(DATA).read()) + '\n</script>\n')
print(f'web/mall/index.html  {round(os.path.getsize(OUT)/1024)} KB')
