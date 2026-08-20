"""Mall directory image -> navigation data.

Emits the same shape of feature the vector-tile source does, so the routing and
narration engine does not need to know the data came from a picture:

    units : [{id, cat, centroid, poly, node}]
    graph : {nodes:[[x,y]], edges:[[a,b,w]]}

Everything is in image pixel coordinates; scale is applied later (see SCALE).
"""
import json, os, sys, collections
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize, remove_small_objects
from skimage.measure import find_contours, approximate_polygon

# Where the source sheets live. They are NOT committed (venue material); set
# MALL_IMAGES to point at your own copies.
SRC = os.environ.get('MALL_IMAGES', './images') + '/'
DARK = 0x70          # anything at or below this is a boundary line or background
MIN_UNIT = 400       # px; smaller blobs are label boxes and icons, not shops


# ---------------------------------------------------------------- walkable
def walkable(a):
    """The concourse: dark fill that is NOT reachable from the image border."""
    dark = a.max(axis=2) <= DARK
    seed = np.zeros_like(dark)
    seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    seed &= dark
    outside = ndimage.binary_propagation(seed, mask=dark)
    inside = dark & ~outside
    inside = remove_small_objects(inside, 3000)
    lbl, n = ndimage.label(inside, structure=np.ones((3, 3)))
    if not n:
        return inside
    sizes = ndimage.sum(inside, lbl, range(1, n + 1))
    return ndimage.binary_closing(lbl == (np.argmax(sizes) + 1), np.ones((5, 5)))


def centreline_graph(mask):
    """Skeletonise the concourse and reduce it to junction nodes + weighted edges."""
    skel = skeletonize(mask)
    ys, xs = np.nonzero(skel)
    pix = set(zip(ys.tolist(), xs.tolist()))
    nb = lambda y, x: [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                       if (dy or dx) and (y + dy, x + dx) in pix]
    deg = {p: len(nb(*p)) for p in pix}
    ends = {p for p in pix if deg[p] != 2} or {next(iter(pix))}

    idx, nodes, edges, seen = {}, [], [], set()
    def nid(p):
        if p not in idx:
            idx[p] = len(nodes); nodes.append([int(p[1]), int(p[0])])   # x, y
        return idx[p]

    for s in ends:
        for first in nb(*s):
            if (s, first) in seen:
                continue
            path, prev, cur = [s, first], s, first
            seen.add((s, first))
            while cur not in ends:
                nxt = [q for q in nb(*cur) if q != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                path.append(cur)
            seen.add((cur, prev))
            w = sum(float(np.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]))
                    for i in range(len(path) - 1))
            a_, b_ = nid(s), nid(cur)
            if a_ != b_ and w > 0:
                edges.append([a_, b_, round(w, 1)])
    return nodes, edges, skel


# ------------------------------------------------------------------ legend
def legend_bands(a, max_x=0.20, max_y=0.45, min_band=10):
    """Colour swatches down the left edge give colour -> category, per sheet."""
    sub = a[:int(a.shape[0] * max_y), :int(a.shape[1] * max_x)]
    sat = sub.max(axis=2).astype(int) - sub.min(axis=2).astype(int)
    is_col = (sub.max(axis=2) > 0x50) & (sat > 12)
    rows = [None if is_col[y].sum() < 60 else np.median(sub[y][is_col[y]], axis=0)
            for y in range(sub.shape[0])]
    bands, start, cur, x_max = [], None, None, 0
    for y, c in enumerate(rows + [None]):
        if cur is not None and c is not None and np.abs(c - cur).sum() < 40:
            cur = 0.7 * cur + 0.3 * c
            x_max = max(x_max, int(np.nonzero(is_col[y])[0].max()) if is_col[y].any() else 0)
            continue
        if cur is not None and start is not None and y - start >= min_band:
            band = np.array([r for r in rows[start:y] if r is not None])
            bands.append({'colour': [int(v) for v in np.median(band, axis=0)],
                          'y0': start, 'y1': y})
        start, cur = (y, c) if c is not None else (None, None)
    return bands, x_max


# ------------------------------------------------------------------- units
def units(a, bands, legend_box):
    dark = a.max(axis=2) <= DARK
    white = a.min(axis=2) >= 0xE0
    body = ~dark & ~white
    y2, x2 = legend_box
    body[:y2, :x2] = False

    lbl, n = ndimage.label(body, structure=np.ones((3, 3)))
    sw = np.array([b['colour'] for b in bands], dtype=float)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lbl), 1):
        m = lbl[sl] == i
        if m.sum() < MIN_UNIT:
            continue
        ys_, xs_ = sl
        # The building outline is a light stroke that is neither dark nor white,
        # so it survives as one enormous, nearly empty component. A real unit
        # fills a good share of its bounding box; a filament fills almost none.
        if m.sum() / max(1, (ys_.stop - ys_.start) * (xs_.stop - xs_.start)) < 0.20:
            continue
        col = np.median(a[sl][m], axis=0)
        d = np.abs(sw - col).sum(axis=1)
        k = int(np.argmin(d))
        ys, xs = sl
        # outline, simplified enough to draw but keep the shape
        pad = np.zeros((m.shape[0] + 2, m.shape[1] + 2), bool)
        pad[1:-1, 1:-1] = m
        cs = find_contours(pad.astype(float), 0.5)
        poly = []
        if cs:
            c = max(cs, key=len)
            c = approximate_polygon(c, tolerance=2.0)
            poly = [[int(xs.start + p[1] - 1), int(ys.start + p[0] - 1)] for p in c]
        # A centre of mass falls outside an L- or C-shaped unit, which would put
        # its label in the void and snap it to the wrong walkway. Use the point
        # deepest inside the shape instead.
        dt = ndimage.distance_transform_edt(pad)[1:-1, 1:-1]
        cy, cx = np.unravel_index(int(np.argmax(dt)), dt.shape)
        out.append({'id': len(out), 'cat': k, 'cat_dist': float(d[k]),
                    # keep the unit's own colour: per-sheet legend detection is
                    # unreliable, so categories are resolved later against one
                    # canonical palette shared by every floor.
                    'rgb': [int(v) for v in col],
                    'px': int(m.sum()),
                    'centroid': [int(xs.start + cx), int(ys.start + cy)],
                    'bbox': [int(xs.start), int(ys.start), int(xs.stop), int(ys.stop)],
                    'poly': poly})
    return out


def snap(units_, nodes):
    """Attach each shop to the nearest point on the concourse centreline."""
    N = np.array(nodes, dtype=float)
    for u in units_:
        c = np.array(u['centroid'], dtype=float)
        d = np.hypot(*(N - c).T)
        j = int(np.argmin(d))
        u['node'] = j
        u['snap_px'] = float(d[j])
    return units_


def run(name, out_json):
    a = np.array(Image.open(SRC + name).convert('RGB'))
    bands, lx = legend_bands(a)
    lbox = (max(b['y1'] for b in bands) + 12, lx + 12) if bands else (0, 0)
    mask = walkable(a)
    nodes, edges, skel = centreline_graph(mask)
    us = snap(units(a, bands, lbox), nodes)

    data = {'image': name, 'size': [int(a.shape[1]), int(a.shape[0])],
            'legend': bands, 'nodes': nodes, 'edges': edges, 'units': us}
    json.dump(data, open(out_json, 'w'), separators=(',', ':'))
    print(f'{name}: {len(bands)} categories, {len(nodes)} nodes, {len(edges)} edges, '
          f'{len(us)} units  -> {out_json}')
    far = [u for u in us if u['snap_px'] > 120]
    print(f'   units far from any walkway: {len(far)}')
    return data, mask, skel, a


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else '4.png',
        sys.argv[2] if len(sys.argv) > 2 else 'mall_4.json')
