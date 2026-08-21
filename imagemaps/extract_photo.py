"""Extract a walk graph from a PHOTOGRAPH of a wayfinding board.

The mall sheets are clean exports where the concourse is the dark fill. An
airport signboard photographed off the wall inverts that: the concourse is a
bright yellow and the shops are the coloured strips around it. Everything
downstream is the same, so only the "which pixels are walkable" test changes -
which is the argument for keeping that test a parameter rather than a constant.

Shops are NOT segmented here. On these boards many tenancies share one red, so
colour components merge them into a single blob; they are placed by hand in the
venue file instead.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import remove_small_objects

from .extract import centreline_graph


def yellow_concourse(a, min_rg=150, min_gap=60):
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    return (r > min_rg) & (g > min_rg) & (r - b > min_gap) & (g - b > min_gap)


def walkable(a, mask_fn=yellow_concourse, close_r=3, min_blob=4000):
    m = mask_fn(a)
    # A photo carries glare bands and antialiasing; closing knits the concourse
    # back together across them before anything is measured.
    m = ndimage.binary_closing(m, np.ones((close_r * 2 + 1,) * 2))
    m = remove_small_objects(m, min_blob)
    lbl, n = ndimage.label(m, structure=np.ones((3, 3)))
    if not n:
        return m
    sizes = ndimage.sum(m, lbl, range(1, n + 1))
    return lbl == (int(np.argmax(sizes)) + 1)


def run(img_path, out_json):
    a = np.array(Image.open(img_path).convert('RGB'))
    mask = walkable(a)
    nodes, edges, skel = centreline_graph(mask)   # skeletonises internally

    adj = {}
    for x, y, w in edges:
        adj.setdefault(x, []).append(y); adj.setdefault(y, []).append(x)
    seen, comps = set(), []
    for s in range(len(nodes)):
        if s in seen or s not in adj:
            continue
        st, c = [s], []
        while st:
            u = st.pop()
            if u in seen:
                continue
            seen.add(u); c.append(u)
            st += [v for v in adj.get(u, []) if v not in seen]
        comps.append(c)
    comps.sort(key=len, reverse=True)

    data = {'image': os.path.basename(img_path),
            'size': [int(a.shape[1]), int(a.shape[0])],
            'nodes': nodes, 'edges': edges, 'units': []}
    json.dump(data, open(out_json, 'w'), separators=(',', ':'))
    biggest = len(comps[0]) if comps else 0
    print(f'{os.path.basename(img_path)}: concourse {100*mask.mean():.1f}% of image, '
          f'{len(nodes)} nodes, {len(edges)} edges, {len(comps)} components, '
          f'largest {biggest} ({100*biggest/max(1,len(nodes)):.0f}%)')
    return data, mask, skel


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
