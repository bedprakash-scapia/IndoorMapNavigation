"""Read shop names off a floor plan with Claude vision.

Until now this was the one manual step: the extractor finds every unit, but the
names had to be transcribed by hand into names_<sheet>.json. Classic OCR is a
poor fit here - the labels are small, frequently rotated 90 degrees, and set in
stylised type - but a vision model reads them without difficulty.

Each unit is sent as its own crop with its outline drawn on, because a crop
always contains neighbouring shops too and the model would otherwise have no way
to know which one it is being asked about. Crops go up in batches, and the reply
is parsed through a schema rather than scraped out of prose.

    export ANTHROPIC_API_KEY=...
    python3 -m imagemaps.autoname venues/mall/mall_4.json --out venues/mall/names_4.json
    python3 -m imagemaps.autoname venues/mall/mall_4.json --compare venues/mall/names_4.json

The --compare mode scores a fresh run against names you already trust, which is
the only honest way to find out how far to trust it on a venue you have not
checked by hand.
"""
import argparse, base64, io, json, os, sys, time

import numpy as np
from PIL import Image, ImageDraw

MODEL = 'claude-opus-5'
BATCH = 12               # crops per request
MAX_PX = 420             # a shopfront label needs no more resolution than this
SRC = os.environ.get('MALL_IMAGES', './images') + '/'

SYSTEM = """You read shop names off shopping-centre and airport floor plans.

Each image is one tenancy on a directory map, outlined in magenta. Neighbouring
units are visible around it - ignore them completely and report only the name
written inside the magenta outline.

Rules:
- Labels are often rotated 90 degrees. Read them anyway.
- Give the name exactly as printed, in normal capitalisation: "Marks & Spencer",
  not "MARKS & SPENCERS" and not "marks and spencer".
- A unit with no name written in it - a vacant lot, a corridor, a plain coloured
  block, an atrium void - gets null. Do not invent a name and do not borrow one
  from a neighbour.
- If a label is cut off or you cannot read it with confidence, use null. A wrong
  name is worse than a missing one: these become the landmarks in walking
  directions, so a mistake sends someone to the wrong place."""


def _schema_model():
    """Built lazily so the module imports without pydantic for --compare-only use."""
    from pydantic import BaseModel
    from typing import List, Optional

    class Unit(BaseModel):
        id: int
        name: Optional[str]
        confident: bool

    class Reply(BaseModel):
        units: List[Unit]

    return Reply


def crop_png(sheet, u, img):
    """One unit, outlined, with a little context around it."""
    x0, y0, x1, y1 = u['bbox']
    pad = max(14, (x1 - x0) // 6, (y1 - y0) // 6)
    box = (max(0, x0 - pad), max(0, y0 - pad),
           min(img.width, x1 + pad), min(img.height, y1 + pad))
    c = img.crop(box).convert('RGB')
    d = ImageDraw.Draw(c)
    if u.get('poly'):
        pts = [(p[0] - box[0], p[1] - box[1]) for p in u['poly']]
        if len(pts) >= 2:
            d.line(pts + [pts[0]], fill=(255, 0, 200), width=5)
    else:
        d.rectangle([x0 - box[0], y0 - box[1], x1 - box[0], y1 - box[1]],
                    outline=(255, 0, 200), width=5)
    c.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
    buf = io.BytesIO(); c.save(buf, 'PNG')
    return base64.standard_b64encode(buf.getvalue()).decode()


def name_batch(client, Reply, sheet, batch, img):
    content = []
    for u in batch:
        content.append({'type': 'image', 'source': {
            'type': 'base64', 'media_type': 'image/png', 'data': crop_png(sheet, u, img)}})
        content.append({'type': 'text', 'text': f'id {u["id"]}'})
    content.append({'type': 'text', 'text':
        'Report one entry per image above, using the id printed after each one. '
        'Set confident to false where you are guessing.'})

    resp = client.messages.parse(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{'role': 'user', 'content': content}],
        output_format=Reply,
    )
    if resp.stop_reason == 'refusal':
        raise SystemExit(f'Refused: {getattr(resp.stop_details, "explanation", "")}')
    return {u.id: (u.name, u.confident) for u in resp.parsed_output.units}


def run(sheet_json, out_path, compare_path, limit):
    import anthropic

    sheet = json.load(open(sheet_json))
    img_path = SRC + sheet['image']
    if not os.path.exists(img_path):
        raise SystemExit(f'Source sheet not found: {img_path}\n'
                         f'Set MALL_IMAGES to the folder holding {sheet["image"]}.')
    img = Image.open(img_path)
    units = sheet['units'][:limit] if limit else sheet['units']

    client = anthropic.Anthropic()
    got, t0 = {}, time.time()
    for i in range(0, len(units), BATCH):
        batch = units[i:i + BATCH]
        try:
            got.update(name_batch(client, _schema_model(), sheet, batch, img))
        except anthropic.RateLimitError as e:
            wait = int(e.response.headers.get('retry-after', '30'))
            print(f'  rate limited, waiting {wait}s', file=sys.stderr)
            time.sleep(wait)
            got.update(name_batch(client, _schema_model(), sheet, batch, img))
        print(f'  {min(i+BATCH, len(units))}/{len(units)} units', file=sys.stderr)

    names = {str(u['id']): (got.get(u['id'], (None, False))[0] or None) for u in units}
    unsure = [k for k, v in got.items() if v[0] and not v[1]]

    if out_path:
        names['_note'] = ('unit id -> shop name, read by claude vision. '
                          'null = unlabelled/vacant, or too unclear to call.')
        json.dump(names, open(out_path, 'w'), indent=1, sort_keys=True)
        print(f'wrote {out_path}: {sum(1 for k,v in names.items() if k != "_note" and v)} named '
              f'of {len(units)}  ({time.time()-t0:.0f}s)')
    if unsure:
        print(f'flagged low confidence ({len(unsure)}): ids {sorted(unsure)}')

    if compare_path:
        score(names, json.load(open(compare_path)))


def norm(s):
    if not s: return None
    s = ''.join(ch for ch in s.lower() if ch.isalnum() or ch == ' ')
    return ' '.join(s.replace(' and ', ' & ').split()) or None


def score(auto, truth):
    """How far can this be trusted? Compare against names checked by hand."""
    ids = [k for k in truth if k != '_note']
    same = diff = auto_blank = truth_blank = 0
    misses = []
    for k in ids:
        a, t = norm(auto.get(k)), norm(truth.get(k))
        if t is None and a is None: truth_blank += 1
        elif t is None: diff += 1; misses.append((k, truth.get(k), auto.get(k)))
        elif a is None: auto_blank += 1
        elif a == t: same += 1
        else: diff += 1; misses.append((k, truth.get(k), auto.get(k)))
    named = sum(1 for k in ids if norm(truth.get(k)))
    print(f'\ncompared against {os.path.basename("truth")}: {len(ids)} units')
    print(f'  exact match      : {same} / {named} named  ({100*same/max(1,named):.0f}%)')
    print(f'  wrong name       : {diff}')
    print(f'  left blank by AI : {auto_blank}  (a miss, not an error)')
    print(f'  correctly blank  : {truth_blank}')
    for k, t, a in misses[:15]:
        print(f'    id {k}: expected {t!r}, got {a!r}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('sheet', help='extractor output, e.g. venues/mall/mall_4.json')
    p.add_argument('--out', help='write names JSON here')
    p.add_argument('--compare', help='score against a names JSON you trust')
    p.add_argument('--limit', type=int, help='only do the first N units (a cheap dry run)')
    a = p.parse_args()
    if not a.out and not a.compare:
        p.error('give --out, --compare, or both')
    run(a.sheet, a.out, a.compare, a.limit)
