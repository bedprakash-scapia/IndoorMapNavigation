"""Merge per-floor extractions into ONE levelled graph the router can cross.

Each floor keeps its own pixel coordinates; nodes are tagged with a level and
the floors are stitched together at escalator shafts, matched by atrium name.
"""
import json, os
import numpy as np

VENUE = os.environ.get('MALL_VENUE', 'venues/mall') + '/'

from .categories import CATEGORIES, STRONG, dedupe_categories, BUILDING_WIDTH_M

ESC_COST_M = 22.0     # metres-equivalent for riding one escalator
SNAP_MAX_PX = 260     # a shaft further than this from the walkway is a bad reading


def canonical_palette(src=VENUE + 'mall_4.json'):
    """One palette for every floor. Per-sheet legend detection misses bands,
    which silently shifts every category after the gap."""
    bands, _ = dedupe_categories(json.load(open(src))['legend'])
    return np.array([b['colour'] for b in bands], dtype=float)


def nearest(nodes, xy):
    N = np.array(nodes, dtype=float)
    d = np.hypot(*(N - np.array(xy, dtype=float)).T)
    j = int(np.argmin(d))
    return j, float(d[j])


def main(cfg=VENUE + 'floors.json', out=VENUE + 'mall_multi.json'):
    conf = json.load(open(cfg))
    pal = canonical_palette()

    nodes, edges, units, floors = [], [], [], []
    base = {}
    m_per_px = None

    for f in conf['floors']:
        d = json.load(open(VENUE + f['src']))
        nm = json.load(open(VENUE + f['names']))
        off = len(nodes)
        base[f['id']] = off
        for (x, y) in d['nodes']:
            nodes.append([x, y, f['id']])
        for a, b, w in d['edges']:
            edges.append([a + off, b + off, w, 0])          # 0 = same-floor walk

        if m_per_px is None:
            xs = [u['centroid'][0] for u in d['units']]
            m_per_px = BUILDING_WIDTH_M / (max(xs) - min(xs))

        for u in d['units']:
            name = nm.get(str(u['id']))
            if not name:
                continue
            k = int(np.argmin(np.abs(pal - np.array(u['rgb'], dtype=float)).sum(axis=1)))
            cat = CATEGORIES[k] if k < len(CATEGORIES) else 'Other'
            units.append({'n': name, 'cat': cat, 'l': f['id'],
                          'c': u['centroid'], 'poly': u['poly'],
                          'v': u['node'] + off,
                          's': 6 if cat in STRONG else 4})
        floors.append({'id': f['id'], 'name': f['name'], 'order': f['order'],
                       'size': d['size']})
        f['_data'] = d

    # ---- vertical shafts, matched by atrium name ----
    shafts, links = {}, []
    for f in conf['floors']:
        for e in f['escalators']:
            j, dpx = nearest(f['_data']['nodes'], e['xy'])
            if dpx > SNAP_MAX_PX:
                print(f"  ! {f['id']} {e['atrium']}: {dpx:.0f} px from any walkway - skipped")
                continue
            shafts.setdefault(e['atrium'], []).append(
                {'floor': f['id'], 'node': j + base[f['id']], 'order':
                 next(x['order'] for x in conf['floors'] if x['id'] == f['id'])})

    w_esc = ESC_COST_M / m_per_px
    for atrium, ends in shafts.items():
        ends.sort(key=lambda e: e['order'])
        for a, b in zip(ends, ends[1:]):
            edges.append([a['node'], b['node'], round(w_esc, 1), 1])   # 1 = escalator
            links.append((atrium, a['floor'], b['floor']))

    data = {'m_per_px': round(m_per_px, 5), 'categories': CATEGORIES,
            'palette': {CATEGORIES[i]: '#%02X%02X%02X' % tuple(int(v) for v in c)
                        for i, c in enumerate(pal) if i < len(CATEGORIES)},
            'floors': floors, 'nodes': nodes, 'edges': edges, 'units': units,
            'shafts': [{'atrium': a, 'ends': [{'floor': e['floor'], 'node': e['node']}
                                              for e in v]}
                       for a, v in shafts.items() if len(v) > 1]}
    json.dump(data, open(out, 'w'), separators=(',', ':'))

    import collections, os
    print(f'{out}: {len(nodes)} nodes, {len(edges)} edges, {len(units)} shops, '
          f'{len(floors)} floors, {round(os.path.getsize(out)/1024)} KB')
    print(f'  shops per floor: {dict(collections.Counter(u["l"] for u in units))}')
    print(f'  vertical links ({len(links)}):')
    for a, x, y in links:
        print(f'     {a}: {x} <-> {y}')
    lone = [a for a, v in shafts.items() if len(v) < 2]
    if lone:
        print(f'  shafts on one floor only (no link): {lone}')


if __name__ == '__main__':
    main()
