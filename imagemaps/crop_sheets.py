"""One tightly-cropped tile per unit, with its id printed outside the image.

Reading a badge drawn on top of the map is ambiguous at small sizes; printing
the id in its own gutter above each crop removes the guesswork.
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

SRC = '/Users/bedprakash.rout/.claude/image-cache/3208c49e-4516-49c1-9639-e970b02de2b9/'
COLS, ROWS = 6, 4
CW, CH = 260, 210
GUT = 30


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf',
              '/System/Library/Fonts/Helvetica.ttc'):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def main(js='mall_4.json'):
    d = json.load(open(js))
    im = Image.open(SRC + d['image']).convert('RGB')
    us = sorted(d['units'], key=lambda u: u['id'])
    f = font(20)
    per = COLS * ROWS
    for s in range((len(us) + per - 1) // per):
        sheet = Image.new('RGB', (CW * COLS, (CH + GUT) * ROWS), (12, 12, 12))
        dr = ImageDraw.Draw(sheet)
        for k, u in enumerate(us[s * per:(s + 1) * per]):
            x0, y0, x1, y1 = u['bbox']
            pad = max(14, (x1 - x0) // 6, (y1 - y0) // 6)
            box = (max(0, x0 - pad), max(0, y0 - pad),
                   min(im.width, x1 + pad), min(im.height, y1 + pad))
            crop = im.crop(box).copy()
            # Outline the unit itself: the crop shows neighbours too, and without
            # this it is impossible to tell which shop the id refers to.
            if u['poly']:
                cd = ImageDraw.Draw(crop)
                pts = [(p[0] - box[0], p[1] - box[1]) for p in u['poly']]
                cd.line(pts + [pts[0]], fill=(255, 0, 200), width=5)
            crop.thumbnail((CW - 12, CH - 12), Image.LANCZOS)
            px, py = (k % COLS) * CW, (k // COLS) * (CH + GUT)
            dr.rectangle([px, py, px + CW - 2, py + GUT - 4], fill=(250, 210, 40))
            dr.text((px + 8, py + 4), f'id {u["id"]}', fill=(0, 0, 0), font=f)
            sheet.paste(crop, (px + 6, py + GUT))
        nm = f'sheet_{s}.png'
        sheet.save(nm)
        print('wrote', nm, sheet.size, f'ids {us[s*per]["id"]}..{us[min((s+1)*per, len(us))-1]["id"]}')


if __name__ == '__main__':
    main(*(sys.argv[1:] or []))
