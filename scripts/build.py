"""Fetch a venue, build per-site graphs + zoning, report, and export for the web app."""
import json, os, sys, collections

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from indoor.source import WoosmapSource, split_sites, pois_of
from indoor.graph import IndoorGraph, Zoning
from indoor.route import Navigator
from indoor.venue import VENUES

# The Woosmap key is the airport's own public, referrer-restricted site key.
# It is deliberately NOT committed. See docs/DATA.md for how to obtain it.
KEY = os.environ.get('WOOSMAP_KEY', '')
REF = os.environ.get('WOOSMAP_REFERER', 'https://www.bengaluruairport.com/')
ROOT = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(ROOT, 'data', 'raw_features.json')
STITCH_M = 8.0   # bridge doorway-sized gaps in the published walk network


def load(cfg, refresh=False):
    """Cached fetch. data/raw_features.json is gitignored; delete it or pass
    --refresh to re-fetch. Only the fetch needs WOOSMAP_KEY."""
    if not refresh:
        try:
            return json.load(open(CACHE))
        except Exception:
            pass
    if not KEY:
        raise SystemExit(
            'No cached data at data/raw_features.json and WOOSMAP_KEY is not set.\n'
            'Export the key (see docs/DATA.md) and re-run:\n'
            '    export WOOSMAP_KEY=...\n'
            '    python3 scripts/build.py --refresh')
    src = WoosmapSource(KEY, REF)
    feats = []
    for v in src.venues():
        if not v['venue_id'].startswith('bial'): continue
        if v['venue_id'] == 'bial': continue      # union venue: duplicates both terminals
        feats += src.features(v['venue_id'], v['bbox'], z=17)
    json.dump(feats, open(CACHE, 'w'))
    print('fetch errors:', dict(src.errors))
    return feats


def build(cfg, feats):
    out = {}
    for sid, fl in sorted(split_sites(feats, cfg).items()):
        g = IndoorGraph(fl)
        bridges = g.stitch(STITCH_M)
        pois = pois_of(fl)
        for p in pois:
            n, d = g.snap(p['c'], p['level'])
            p['node'], p['snap_m'] = n, d
        z = Zoning(g, pois, cfg)
        nav = Navigator(g, pois, z, cfg, site_name=sid)
        out[sid] = {'graph': g, 'pois': pois, 'zoning': z, 'nav': nav}
        sizes = collections.Counter(g.comp.values())
        zc = collections.Counter(p.get('zone') or 'unzoned' for p in pois if p['node'] is not None)
        print(f"[{sid}] feats={len(fl):5d} nodes={len(g.adj):5d} pois={len(pois):4d} "
              f"components={len(sizes)} (largest {sizes.most_common(1)[0][1]}) bridges={bridges} "
              f"portalnodes={len(z.portal_nodes)}")
        print(f"      zones: {dict(zc)}")
    return out


if __name__ == '__main__':
    cfg = VENUES['blr']
    feats = load(cfg, refresh='--refresh' in sys.argv)
    print(f'total raw features: {len(feats)}')
    sites = build(cfg, feats)

    print('\n===== zone policy checks =====')
    T2 = sites['T2']['nav']
    find = lambda n: next((p for p in sites['T2']['pois'] if p['name'] == n), None)
    for a, b in [('Domestic Security', 'KFC'), ('CheckIn A1 to A15', 'Gate C1'),
                 ('Belt 1', 'Gate C1'), ('Gate C1', 'CheckIn A1 to A15'),
                 ('Belt 1', 'Belt 4')]:
        A, Z = find(a), find(b)
        if not A or not Z: print(f'  {a} -> {b}: POI missing'); continue
        r = T2.directions(A, Z)
        za, zb = A.get('zone'), Z.get('zone')
        if 'error' in r:
            print(f'  {a} [{za}] -> {b} [{zb}]: BLOCKED — {r["error"]}')
        else:
            print(f'  {a} [{za}] -> {b} [{zb}]: {len(r["steps"])} steps, '
                  f'{r["m"]:.0f} m, zones {r["zones"]}')
