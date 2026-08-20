# Navigation from a picture of a floor plan

A second data source. Instead of a mapping provider's vector tiles, this takes
the printed directory sheet a mall hands out and turns it into a routable,
levelled graph.

It works better than the vector source in one important way and worse in another.

| | Airport (vector tiles) | Mall (image) |
|---|---|---|
| Walk network | fragmented, 65 components, needed 8 m stitching | **one component, no stitching** |
| Routable pairs | 100% after stitching | **100%** |
| Landmark coverage | sparse stretches fall back to "towards X" | **0.1% unanchored steps** |
| Shop names | in the data | **must be transcribed** |
| Scale | real metres | **assumed** |

A drawn concourse is continuous by construction, and a mall is wall-to-wall
brands, so almost every instruction can name something you can see.

## How it works

1. **Walkable area.** The concourse is drawn as one dark fill, but so is the
   space outside the building. A flood fill inward from the image border
   separates them, because the building outline is a closed stroke.
2. **Centre line.** The concourse is an area, not a line. Skeletonising it gives
   the path a person actually walks; that skeleton is reduced to junction nodes
   and weighted edges.
3. **Shops.** Every unit is a flat colour region bounded by thin dark lines.
   Connected components of "not dark, not white" give the polygons.
4. **Categories.** The legend printed on the sheet is read row by row, giving a
   colour to category lookup with nothing hard-coded.
5. **Names.** `imagemaps/autoname.py` reads them with Claude vision, one
   outlined crop per unit, into `venues/<venue>/names_<sheet>.json`. Classic OCR
   is a poor fit - the labels are small, often rotated 90 degrees, and stylised -
   but a vision model reads them without difficulty. `imagemaps/crop_sheets.py`
   renders the same crops as contact sheets for reviewing the result by eye.
6. **Floors.** Sheets are extracted separately and merged by
   `imagemaps/build_multi.py`, joined at escalator shafts.

## Running it

```bash
pip install -r requirements-image.txt          # this source needs numpy/scipy/skimage
export MALL_IMAGES=/path/to/sheets             # source images are not committed

python3 -m imagemaps.extract 4.png mall_4.json # one sheet
python3 -m imagemaps.autoname venues/mall/mall_4.json --out venues/mall/names_4.json
python3 -m imagemaps.build_multi               # merge floors, using floors.json
```

Naming needs `ANTHROPIC_API_KEY`, and honours `ANTHROPIC_BASE_URL` if you go
through a gateway. Roughly seven requests per floor (twelve crops each), about a
minute per floor on `claude-opus-5`. To find out how far to trust
it, score a run against names you checked by hand:

```bash
python3 -m imagemaps.autoname venues/mall/mall_4.json --compare venues/mall/names_4.json
python3 -m imagemaps.autoname venues/mall/mall_4.json --out /tmp/n.json --limit 12  # cheap dry run
```

The browser studio can do the same thing, through a proxy that keeps the key
server-side:

```bash
python3 scripts/build_studio.py
python3 scripts/serve_studio.py        # http://127.0.0.1:8080
```

Upload a sheet, then **Auto-name the remaining N**. Without a key the server
still serves the page and the button simply never appears - naming stays manual.
Served as a bare file, or from the published artifact where the CSP blocks
outbound calls, the same fallback applies.

**Marking the unit in a crop: dim, do not outline.** The model has to be told
which shop in the crop it is being asked about, since neighbours are always
visible. Outlining swamps a narrow tenancy - a few pixels of line either side and
the label underneath is gone - and that produced crops the model could not read
at all: 7 of 62 named on the first attempt. Dimming everything that is *not* the
unit fixed it to 59 of 62, and never covers the label.

## Things that cost real debugging time

**A centre of mass falls outside an L-shaped unit.** It lands in the void, which
puts the label in the wrong place *and* snaps the shop to the wrong corridor. Use
the point deepest inside the shape (distance-transform maximum) instead.

**The building outline survives as a shop.** It is neither dark nor white, so it
becomes one enormous component spanning the whole sheet at 0.4% bounding-box
fill. Real units fill 40-85%. Filter on that ratio.

**Per-sheet legend detection is not reliable.** One sheet gave 17 bands, another
14. A missing band silently shifts every category after it, and nothing errors.
Each unit stores its own colour and is matched against **one canonical palette**
shared by every floor.

**A too-loose colour merge collapsed two categories.** Multiplex (olive) and Food
Court (light green) are within 53 of each other; a threshold of 60 merged them
and shifted everything below. Caught only by spot-checking known shops.

**Escalators cannot be found by colour.** Three attempts failed: the glyphs share
their pale cyan with the jewellery category fill and with fire-exit signs. The
best attempt returned three shops and no escalators. Routing a shopper into a
fire stairwell is a real failure, so positions are declared in
`venues/<venue>/floors.json` instead - about six per floor, read off once.

**Floors are not a translation of each other.** The sheets share a drawing frame
but the same atrium sits ~110 px apart between levels, and the offset is not
consistent (one atrium differs by 275 px). Shafts are therefore linked by
**atrium name**, not by pixel position.

## Known limits

- **Scale is assumed.** `BUILDING_WIDTH_M` in `imagemaps/categories.py` sets it.
  Every distance scales off that one guess.
- **Names are model-read, and worth reviewing.** Measured on the two floors that
  were also transcribed by hand, 130 named units:

  | | |
  |---|---|
  | Exact match | 118 (91%) |
  | Genuine misreads | 6 (4.6%) |
  | Cosmetic differences | 6 |
  | Blanks where a name existed | 0 |

  The cosmetic six are arguments, not errors: `CCD` vs `Cafe Coffee Day` (the map
  prints CCD), `Body Shop` vs `The Body Shop`, `Marks & Spencer` vs the sheet's
  `MARKS & SPENCERS`, and `Hunkemöller`, where the model supplied the umlaut the
  hand transcription had dropped. The six genuine misreads are all small rotated
  labels next to a similar neighbour - `Payday & Only` for Rayban & Oakley,
  `Colorbar` for Columbia, `Zara Home` for Kama Ayurveda.

  **The confidence flag earns its keep.** Seven units came back low-confidence and
  six of them were wrong. Reviewing only the flagged ones catches half the errors
  for a fraction of the work, which is the review workflow to use.

  A wrong name is worse than a blank one - these become the landmarks in the
  directions - so the prompt is told to return null rather than guess. It never
  once left a real shop blank across both floors.
- **Landmarks repeat on winding routes** - about 0.6 mentions per route, worst
  case 9, where a path doubles back through an area whose shops are all named.
- **Small units merge** where the dividing line is thin; roughly 73 of ~80 shops
  are captured on the ground floor.
- **A shop name is not a unique key.** Three names repeat across the three floors
  and all three are legitimate: a concierge desk on each floor, two Vero Moda
  stores, and a cinema that spans levels. Look shops up by (name, floor) - a
  name-only lookup silently returned the wrong floor's PVR and made a two-
  escalator route look like a one-escalator route.
- **Source images are not committed** - they are the venue's material. The
  extracted JSON is, so everything downstream runs offline.
- This does **not** yet go through `indoor/`. The narrator in `web/mall/app.js`
  is a third implementation of the same logic. Folding this in behind a common
  `Source` is the obvious next step.
