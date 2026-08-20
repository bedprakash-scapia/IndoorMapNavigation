"""Assemble web/studio/index.html - the upload-your-own-map wayfinder.

Self-contained by design: the extraction runs in the browser, so the page needs
no server and the uploaded image never leaves the machine it was opened on.
"""
import os
ROOT = os.path.join(os.path.dirname(__file__), '..')
W = os.path.join(ROOT, 'web', 'studio')
head = open(os.path.join(W, 'studio.tpl.html')).read()
js = open(os.path.join(W, 'extract.js')).read() + '\n' + open(os.path.join(W, 'studio.js')).read()
out = os.path.join(W, 'index.html')
open(out, 'w').write(head + '\n<script>\n' + js + '\n</script>\n')
print(f'web/studio/index.html  {round(os.path.getsize(out)/1024)} KB')
