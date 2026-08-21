"""Assemble the Delhi T3 Domestic Departures venue.

The walk graph comes out of the photograph automatically (imagemaps/extract_photo).
The shops do not: on this board many tenancies share one red, so colour
components merge them into a single blob. They are placed here by hand from the
board, which is honest work rather than a failure of the extractor - a signboard
photographed off a wall is a harder input than a vector export.

Coordinates are in the pixel space of the two cropped plans.
"""
import base64, io, json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'del_multi.json')

# The board is photographed at an angle, so the plans carry some perspective
# skew. Distances are therefore indicative; the directions do not depend on them.
CONCOURSE_LEN_M = 260.0

CATS = {
    'F': ('Food & Drink',   '#2FB39B', 6),
    'R': ('Retail',         '#B4232A', 6),
    'B': ('Beauty & Books', '#C9536B', 5),
    'L': ('Lounge',         '#E8792B', 6),
    'S': ('Services',       '#6E8FC9', 4),
    'G': ('Gates',          '#E9C33B', 5),
}

DEP = [
    ('Gates 27-36',        'G', 285, 150), ('Gate 27',        'G', 175, 265),
    ('Gate 28',            'G', 400, 265), ('Gates 37-62',    'G', 120, 950),
    ('Croma',              'R', 600, 293), ('Guardian Pharmacy','S', 712, 290),
    ('FabIndia',           'R', 566, 356), ('Dilli Streat',   'F', 540, 437),
    ('Burger King',        'F', 447, 400), ('Starbucks Coffee','F', 447, 447),
    ('WHSmith',            'R', 560, 537), ('Tim Hortons',    'F', 420, 528),
    ('Biba',               'R', 215, 570), ("Haldiram's",     'F', 690, 655),
    ('Swarovski',          'B', 748, 600), ('Puma',           'R', 795, 640),
    ('W',                  'R', 985, 648), ('The Olfactive',  'B', 1090, 655),
    ('Tribe',              'B', 1128, 655), ('Go Colors',     'R', 1160, 650),
    ('Helios',             'R', 1205, 660), ('Rado',          'R', 1212, 692),
    ('Benetton',           'R', 1098, 292), ('Lacoste',       'R', 1200, 292),
    ('Marks & Spencer',    'R', 1370, 358), ('M.A.C',         'B', 1395, 487),
    ('Hamleys',            'R', 1400, 527), ('Sunglass Hut',  'B', 1395, 573),
    ('Mont Blanc',         'R', 1395, 610), ('Porsche Design', 'R', 1398, 645),
    ('Tumi',               'R', 1385, 730), ('Choco Bay',     'F', 915, 210),
    ('Toilets (West)',     'S', 215, 322), ('Child Care Room','S', 220, 376),
    ('Toilets (Central)',  'S', 700, 700), ('Smoking Room',   'S', 490, 700),
]

FOOD = [
    ("McDonald's",   'F', 170, 235), ('KFC',            'F', 180, 295),
    ('Nourish',      'F', 175, 348), ("Kishin's",       'F', 175, 452),
    ("Berco's",      'F', 180, 498), ("Domino's Pizza", 'F', 180, 550),
    ('Pappa Roti',   'F', 205, 602), ('Dhaba at T3',    'F', 205, 648),
    ("Karim's",      'F', 205, 700), ('Subway',         'F', 225, 742),
    ('Encalm Lounge West', 'L', 680, 715), ('Encalm Lounge East', 'L', 990, 715),
    ('Air India Lounge',   'L', 1290, 480),
    ('Toilets (Food Court)', 'S', 640, 800), ('Smoking Room (Food Court)', 'S', 565, 730),
]

# Same shaft, both plans: "Up to Food Court Level" / "Down to Departures Level".
SHAFTS = [('Main Escalator', (830, 215), (487, 243))]


def data_uri(path, max_w=1500, q=76):
    im = Image.open(path).convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(), im.size


def nearest(nodes, xy):
    return min(range(len(nodes)),
               key=lambda i: (nodes[i][0] - xy[0]) ** 2 + (nodes[i][1] - xy[1]) ** 2)


def main():
    plans = [('D', 'Departures', 0, 'dep.json', 'del_dep.png', DEP),
             ('F', 'Food Court', 1, 'food.json', 'del_food.png', FOOD)]
    nodes, edges, units, floors, base = [], [], [], [], {}
    m_per_px = None

    for fid, fname, order, gj, img, shops in plans:
        g = json.load(open(os.path.join(HERE, gj)))
        base[fid] = len(nodes)
        for x, y in g['nodes']:
            nodes.append([x, y, fid])
        for a, b, w in g['edges']:
            edges.append([a + base[fid], b + base[fid], w, 0])
        uri, size = data_uri(os.path.join(HERE, img))
        if m_per_px is None:
            m_per_px = CONCOURSE_LEN_M / size[0]
        floors.append({'id': fid, 'name': fname, 'order': order,
                       'size': [size[0], size[1]], 'img': uri})
        sx = size[0] / g['size'][0]
        for name, cat, x, y in shops:
            x, y = round(x * sx), round(y * sx)
            v = nearest(g['nodes'], (x / sx, y / sx)) + base[fid]
            units.append({'n': name, 'cat': CATS[cat][0], 'l': fid,
                          'c': [x, y], 'v': v, 's': CATS[cat][2]})

    w_esc = 22.0 / m_per_px
    for name, dep_xy, food_xy in SHAFTS:
        a = nearest(json.load(open(os.path.join(HERE, 'dep.json')))['nodes'], dep_xy) + base['D']
        b = nearest(json.load(open(os.path.join(HERE, 'food.json')))['nodes'], food_xy) + base['F']
        edges.append([a, b, round(w_esc, 1), 1])

    data = {'m_per_px': round(m_per_px, 5),
            'categories': [v[0] for v in CATS.values()],
            'palette': {v[0]: v[1] for v in CATS.values()},
            'floors': floors, 'nodes': nodes, 'edges': edges, 'units': units}
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    print(f'{OUT}: {len(nodes)} nodes, {len(edges)} edges, {len(units)} places, '
          f'{len(floors)} levels, {round(os.path.getsize(OUT)/1024)} KB')


if __name__ == '__main__':
    main()
