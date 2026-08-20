"""Assemble the browser bundle: named units + walk graph + categories."""
import json, collections
import numpy as np

# Legend order on the sheet, top to bottom. The extractor finds the swatch
# colours; these are the words that go with them.
CATEGORIES = [
    'Sportswear & Sportsgear',
    'Department Stores',
    'Foot Fashion, Bags & Luggage',
    'Watches, Jewellery & Accessories',
    'Cosmetics, Salon, Spa & Optics',
    'General Fashion',
    'Cafes, Restaurants & Desserts',
    "Women's Fashion",
    "Men's Fashion",
    'Electronics & Gadgets',
    'Home, Gifts & Hobbies',
    'Ethnic Fashion',
    'Kids Fashion',
    'Multiplex & Entertainment',
    'Food Court',
    'Books, Music, Toys & Games',
    'Hypermarket & Gourmet',
]

# The sheet is not drawn to a stated scale. This mall's ground floor spans about
# 220 m end to end, which sets the pixel size. Distances are therefore
# approximate and labelled as such in the UI.
BUILDING_WIDTH_M = 220.0

# Which categories make a good landmark to steer by. A jeweller counter is
# forgettable; a Krispy Kreme is not.
STRONG = {'Cafes, Restaurants & Desserts', 'Department Stores', 'Food Court',
          'Multiplex & Entertainment', 'Sportswear & Sportsgear',
          'Electronics & Gadgets', 'Books, Music, Toys & Games',
          'Hypermarket & Gourmet', 'Kids Fashion'}


def dedupe_categories(bands):
    """A swatch with a gradient gets split into several bands, so the raw count
    overshoots the printed legend. Merge neighbouring near-identical colours and
    return both the merged list and a map from raw band index to merged index."""
    out, remap = [], {}
    for i, b in enumerate(bands):
        c = np.array(b['colour'], dtype=float)
        if out and np.abs(np.array(out[-1]['colour'], dtype=float) - c).sum() < 40:
            remap[i] = len(out) - 1
            continue
        remap[i] = len(out)
        out.append(b)
    return out, remap


def main(src='venues/mall/mall_4.json', names='venues/mall/names_4.json',
         out='venues/mall/mall_demo.json'):
    d = json.load(open(src))
    nm = json.load(open(names))
    bands, remap = dedupe_categories(d['legend'])

    xs = [u['centroid'][0] for u in d['units']]
    span_px = max(xs) - min(xs)
    m_per_px = BUILDING_WIDTH_M / span_px

    units = []
    for u in d['units']:
        name = nm.get(str(u['id']))
        if not name:
            continue                                  # unlabelled / vacant
        cat_i = remap.get(u['cat'], 0)
        cat = CATEGORIES[cat_i] if cat_i < len(CATEGORIES) else 'Other'
        units.append({'id': u['id'], 'n': name, 'cat': cat,
                      'c': u['centroid'], 'poly': u['poly'], 'v': u['node'],
                      's': 6 if cat in STRONG else 4})

    palette = {CATEGORIES[i]: '#%02X%02X%02X' % tuple(b['colour'])
               for i, b in enumerate(bands) if i < len(CATEGORIES)}
    data = {'size': d['size'], 'm_per_px': round(m_per_px, 5),
            'categories': CATEGORIES, 'palette': palette,
            'nodes': d['nodes'], 'edges': d['edges'], 'units': units}
    json.dump(data, open(out, 'w'), separators=(',', ':'))

    byc = collections.Counter(u['cat'] for u in units)
    print(f'{out}: {len(units)} named shops, {len(d["nodes"])} nodes, {len(d["edges"])} edges')
    print(f'  scale: 1 px = {m_per_px:.3f} m  (assumed {BUILDING_WIDTH_M:.0f} m span)')
    print('  categories:')
    for k, v in byc.most_common():
        print(f'     {v:3d}  {k}')


if __name__ == '__main__':
    main()
