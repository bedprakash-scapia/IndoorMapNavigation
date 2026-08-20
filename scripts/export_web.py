"""Export the built venue to a compact JSON bundle the browser app can route on."""
import json, os, sys, collections

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import build
from indoor.venue import VENUES

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'web', 'venue_web.json')

cfg = VENUES['blr']
feats = build.load(cfg)
sites = build.build(cfg, feats)

out = {'venue': cfg.name,
       'zones': [{'id': z.id, 'name': z.name, 'short': z.short} for z in cfg.zones],
       'portals': [], 'sites': {}}

for sid, S in sites.items():
    g, pois, z = S['graph'], S['pois'], S['zoning']
    keep = {n for n in g.adj}
    idx = {}; nodes = []
    for n in sorted(keep):
        lo, la, lv = g.nodes[n]
        idx[n] = len(nodes); nodes.append([round(lo, 6), round(la, 6), lv])
    edges = []
    for a, nb in g.adj.items():
        for b, (w, k) in nb.items():
            if a in idx and b in idx and idx[a] < idx[b]:
                edges.append([idx[a], idx[b], round(w, 1),
                              1 if 'transition' in (k or '') else 0,
                              1 if 'elevator' in (k or '') else 0])
    plist, pidx = [], {}
    for p in pois:
        if p['node'] is None or p['node'] not in idx or p['snap_m'] > 30: continue
        pidx[id(p)] = len(plist)
        plist.append({'n': p['name'], 'l': p['level'],
                      'c': [round(p['c'][0], 6), round(p['c'][1], 6)],
                      'k': p['cat'], 's': p['score'], 'v': idx[p['node']],
                      'z': p.get('zone')})
    # which POIs can serve each configured crossing, in this site
    portals = []
    for pc in cfg.portals:
        cand = [pidx[id(c)] for c in z.portals_for(pc, pois) if id(c) in pidx]
        portals.append({'frm': pc.frm, 'to': pc.to, 'verb': pc.verb,
                        'note': pc.note, 'cand': cand})
    out['sites'][sid] = {'name': next(s.name for s in cfg.sites if s.id == sid),
                         'nodes': nodes, 'edges': edges, 'pois': plist,
                         'portals': portals}
    zc = collections.Counter(p['z'] or 'unzoned' for p in plist)
    print(f'{sid}: nodes={len(nodes)} edges={len(edges)} pois={len(plist)} zones={dict(zc)}')
    print(f'    portal candidates: ' +
          ', '.join(f'{p["frm"]}->{p["to"]}:{len(p["cand"])}' for p in portals))

json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('web/venue_web.json', round(os.path.getsize(OUT) / 1024), 'KB')
