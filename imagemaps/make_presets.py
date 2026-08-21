"""Build the studio's known-sheet presets.

The browser extractor and the Python one do not agree on unit ids - the browser
works at reduced resolution and finds slightly fewer units - so the committed
names cannot be reused by id. They can be reused by POSITION: match each browser
unit to the nearest named Python unit and carry the name across.

The result is a cache of a real read, not a table of typed-in strings. Feed it
the browser's unit centroids (id, x, y) captured from the studio.
"""
import json, os, sys

VENUE = os.path.join(os.path.dirname(__file__), '..', 'venues', 'mall')
MAX_PX = 90          # a browser unit further than this from any named Python
                     # unit is one the browser split differently - leave it blank


def build(browser_units, sheet_json, names_json):
    sheet = json.load(open(os.path.join(VENUE, sheet_json)))
    names = json.load(open(os.path.join(VENUE, names_json)))
    named = [(u['centroid'], names.get(str(u['id'])))
             for u in sheet['units'] if names.get(str(u['id']))]

    out, far = {}, 0
    for i, x, y in browser_units:
        best, bd = None, 1e18
        for (cx, cy), nm in named:
            d = (cx - x) ** 2 + (cy - y) ** 2
            if d < bd:
                bd, best = d, nm
        if bd ** 0.5 <= MAX_PX:
            out[str(i)] = best
        else:
            far += 1
    return out, far


if __name__ == '__main__':
    data = json.load(open(sys.argv[1]))     # {"4.png": [[i,x,y],...], ...}
    plan = {'4.png': ('mall_4.json', 'names_4.json', 'Ground'),
            '3.png': ('mall_3.json', 'names_3.json', 'First'),
            '1.png': ('mall_1.json', 'names_1.json', 'Second')}
    presets = {}
    for img, units in data.items():
        sj, nj, floor = plan[img]
        names, far = build(units, sj, nj)
        presets[img] = {'floor': floor, 'units': len(units), 'names': names}
        print(f'{img}: {len(names)} of {len(units)} matched a named unit '
              f'({far} too far to match)')
    json.dump(presets, open(sys.argv[2], 'w'), indent=1, sort_keys=True)
    print('wrote', sys.argv[2])
