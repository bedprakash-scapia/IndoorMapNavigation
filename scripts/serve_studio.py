"""Serve the studio, and give it an auto-name endpoint.

The page cannot call the model itself: a browser has no safe place to keep a
key, and the published artifact's CSP blocks external hosts outright. So the key
stays here, the page calls its own origin, and there is no CORS question.

    export ANTHROPIC_API_KEY=...          # or put it in .env beside this repo
    export ANTHROPIC_BASE_URL=...         # optional, for a gateway
    python3 scripts/serve_studio.py       # http://127.0.0.1:8080

Naming reuses imagemaps/autoname.py's prompt and schema verbatim, so the button
and the command line cannot drift apart.
"""
import json, os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WEB = os.path.join(ROOT, 'web', 'studio')
PORT = int(os.environ.get('PORT', '8080'))
BATCH_MAX = 16
sys.path.insert(0, ROOT)


def load_env():
    p = os.path.join(ROOT, '.env')
    if not os.path.exists(p):
        return
    for line in open(p):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_client = None
_lock = threading.Lock()


def client():
    """Built once, lazily - so the server still starts without a key and the
    page can degrade to manual naming instead of failing at boot."""
    global _client
    with _lock:
        if _client is None:
            import anthropic
            _client = anthropic.Anthropic()
        return _client


def name_images(images):
    """images: [{'id': int, 'b64': str}] -> {id: {'name': str|None, 'confident': bool}}"""
    from imagemaps.autoname import SYSTEM, MODEL, _schema_model
    Reply = _schema_model()
    content = []
    for im in images:
        content.append({'type': 'image', 'source': {
            'type': 'base64', 'media_type': 'image/png', 'data': im['b64']}})
        content.append({'type': 'text', 'text': f'id {im["id"]}'})
    content.append({'type': 'text', 'text':
        'Report one entry per image above, using the id printed after each one. '
        'Set confident to false where you are guessing.'})

    r = client().messages.parse(
        model=MODEL, max_tokens=4000, system=SYSTEM,
        messages=[{'role': 'user', 'content': content}],
        output_format=Reply,
    )
    if r.stop_reason == 'refusal':
        raise RuntimeError('the model declined this batch')
    return {u.id: {'name': u.name, 'confident': u.confident} for u in r.parsed_output.units}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        if '/api/' in (self.path or ''):
            sys.stderr.write('  %s %s\n' % (self.command, self.path))

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/status':
            key = bool(os.environ.get('ANTHROPIC_API_KEY'))
            return self._json(200, {'naming': key,
                                    'base_url': os.environ.get('ANTHROPIC_BASE_URL') or 'anthropic',
                                    'batch_max': BATCH_MAX})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/name':
            return self._json(404, {'error': 'no such endpoint'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n > 40 * 1024 * 1024:
                return self._json(413, {'error': 'batch too large'})
            req = json.loads(self.rfile.read(n) or b'{}')
            images = req.get('images') or []
            if not images:
                return self._json(400, {'error': 'no images'})
            if len(images) > BATCH_MAX:
                return self._json(400, {'error': f'at most {BATCH_MAX} images per request'})
            return self._json(200, {'names': name_images(images)})
        except Exception as e:
            sys.stderr.write(f'  !! {type(e).__name__}: {e}\n')
            return self._json(502, {'error': f'{type(e).__name__}: {str(e)[:200]}'})


if __name__ == '__main__':
    load_env()
    if not os.path.exists(os.path.join(WEB, 'index.html')):
        raise SystemExit('web/studio/index.html missing. Run:\n'
                         '    python3 scripts/build_studio.py')
    keyed = bool(os.environ.get('ANTHROPIC_API_KEY'))
    print(f'studio   http://127.0.0.1:{PORT}/index.html')
    print(f'naming   {"enabled" if keyed else "OFF - no ANTHROPIC_API_KEY, naming stays manual"}'
          + (f'  via {os.environ["ANTHROPIC_BASE_URL"]}' if os.environ.get('ANTHROPIC_BASE_URL') else ''))
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
