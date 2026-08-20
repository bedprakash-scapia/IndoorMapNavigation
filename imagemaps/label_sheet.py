"""Draw numbered badges on every extracted unit and tile the map for reading.

Binding a shop name to the right polygon is the one step that needs eyes. Giving
each polygon a visible id and zooming in makes that a mechanical transcription
rather than a guess.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = '/Users/bedprakash.rout/.claude/image-cache/3208c49e-4516-49c1-9639-e970b02de2b9/'


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf',
              '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def main(js='mall_4.json', cols=3, rows=2, scale=2.0):
    d = json.load(open(js))
    im = Image.open(SRC + d['image']).convert('RGB')
    W, H = im.size
    big = im.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    dr = ImageDraw.Draw(big)
    f = font(int(17 * scale / 2 * 1.6))

    for u in d['units']:
        x, y = u['centroid'][0] * scale, u['centroid'][1] * scale
        r = 15 * scale / 2
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(0, 0, 0), outline=(255, 230, 0), width=3)
        t = str(u['id'])
        tb = dr.textbbox((0, 0), t, font=f)
        dr.text((x - (tb[2] - tb[0]) / 2, y - (tb[3] - tb[1]) / 2 - 2), t,
                fill=(255, 230, 0), font=f)

    BW, BH = big.size
    tw, th = BW // cols, BH // rows
    for r_ in range(rows):
        for c in range(cols):
            box = (c * tw, r_ * th, min((c + 1) * tw, BW), min((r_ + 1) * th, BH))
            tile = big.crop(box)
            tile.thumbnail((1500, 1500), Image.LANCZOS)
            nm = f'tile_{r_}{c}.png'
            tile.save(nm)
            print('wrote', nm, tile.size)


if __name__ == '__main__':
    main(*(sys.argv[1:] or []))
