"""Data adapters: fetch a venue's indoor map and normalise it.

Normalised feature schema (what the rest of the engine consumes):
    {id, name, level, levels[], cat, tags{raw}, pts[(lon,lat)], site}

Swapping in a different provider means writing another Source class that emits
this schema; nothing downstream changes.
"""
import math, json, time, collections, urllib.request
from . import tiles


class WoosmapSource:
    """Woosmap Indoor vector tiles (used by BLR, Gare du Nord and others)."""

    def __init__(self, key, referer=None, base='https://api.woosmap.com'):
        self.key, self.referer, self.base = key, referer, base
        self.errors = collections.Counter()

    def _get(self, url, binary=False, tries=4):
        req = urllib.request.Request(url, headers={'Referer': self.referer} if self.referer else {})
        for i in range(tries):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read() if binary else json.load(r)
            except Exception as ex:
                if getattr(ex, 'code', None) == 404: return None
                self.errors[str(getattr(ex, 'code', type(ex).__name__))] += 1
                time.sleep(0.4 * (i + 1))
        return None

    def venues(self):
        return self._get(f'{self.base}/indoor/venues?key={self.key}') or []

    @staticmethod
    def _tile_range(bbox, z):
        w, s, e, n = bbox
        def xy(lon, lat):
            N = 2 ** z
            la = math.radians(lat)
            return (int((lon + 180) / 360 * N),
                    int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * N))
        x0, y0 = xy(w, n); x1, y1 = xy(e, s)
        return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]

    def features(self, venue_id, bbox, z=17):
        """Every tile's copy is kept: a corridor clipped at a tile edge continues
        in the neighbour, and de-duplicating by feature id would drop that half."""
        out = []
        for (x, y) in self._tile_range(bbox, z):
            buf = self._get(f'{self.base}/indoor/venues/{venue_id}/tiles/{z}/{x}/{y}.pbf?key={self.key}',
                            binary=True)
            if not buf: continue
            for _layer, fl in tiles.decode_tile(buf, x, y, z).items():
                for f in fl:
                    if f['id'] is None or not f['pts']: continue
                    p = f['props']
                    lvs = [s for s in str(p.get('level', '')).split(';') if s]
                    out.append({'id': f['id'], 'name': p.get('name'),
                                'level': lvs[0] if lvs else None, 'levels': lvs,
                                'cat': (p.get('shop') or p.get('amenity') or
                                        p.get('aeroway') or p.get('public_transport') or ''),
                                'tags': p, 'pts': f['pts']})
            time.sleep(0.03)
        return out


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def split_sites(features, cfg):
    """Group features by Site. Source venues bleed into each other's bounding
    boxes, so the building tag — not the venue id — decides the terminal."""
    sites = collections.defaultdict(list)
    for f in features:
        sid = cfg.site_of(f['tags'])
        if sid: sites[sid].append(f)
    return sites


def pois_of(features):
    """Named features, de-duplicated by (name, level), with a centroid."""
    seen = {}
    for f in features:
        if not f['name'] or not f['level']: continue
        t = f['tags']
        # the building outline and per-level polygons carry the venue's own name;
        # they are not places you can walk to or navigate by
        if t.get('indoor') == 'level' or t.get('building:name'): continue
        k = (f['name'], f['level'])
        if k in seen: continue
        seen[k] = {'name': f['name'], 'level': f['level'], 'c': centroid(f['pts']),
                   'cat': f['cat'], 'tags': f['tags']}
    return list(seen.values())
