# CLAUDE.md

Operating guide for Claude instances working in this repo. Read this first, then
`docs/STATUS.md` for what is real today and `docs/ROADMAP.md` for who owns what.

## What this project is

A **generic indoor navigation engine** that gives directions the way people
actually give them — anchored on landmarks you can see, not on distances:

> Stand at **Domestic Security** with it behind you, facing **Domestic Buggy Point**.
> Walk past **Hugo Boss** on your right. Turn right at **P.F. Chang's**.
> Take the lift beside **Johnny Rockets** down to **Level 0**.

Bengaluru Airport (BLR) is the first venue, built on the airport's own published
indoor map. The engine itself knows nothing about BLR.

Two things make this more than a shortest-path demo:

1. **Landmark narration.** Distance is a parenthetical hint; the instruction is
   always a place you can see.
2. **Zones.** An airport is not one navigable space. A gate is airside, a
   check-in desk is landside, a baggage belt is arrivals, and you may only move
   between them through a control point, in one direction. Routes that would
   cross illegally are **refused with a reason**, never quietly routed around.

## Quickstart

```bash
python3 -m venv .venv && .venv/bin/pip install pytest   # only pytest is needed
.venv/bin/python -m pytest tests/ -q                    # 13 tests, no network

python3 scripts/build.py            # build both terminals, print a zone report
python3 scripts/export_web.py       # write web/venue_web.json
python3 scripts/build_web.py        # assemble the single-file demo web/index.html
```

The engine is **pure standard-library Python**. `pytest` is the only dependency,
and only for the tests. Do not add dependencies without a good reason.

`data/raw_features.json` is a cached fetch and is committed, so everything above
works offline. You only need a network and `WOOSMAP_KEY` to re-fetch
(`scripts/build.py --refresh`). See `docs/DATA.md` for how to obtain the key.
**Never commit the key** — this repo is public.

## Repo map

| Path | What it is |
|---|---|
| `indoor/tiles.py` | Dependency-free Mapbox Vector Tile decoder |
| `indoor/source.py` | Provider adapter: fetch tiles, normalise features, split by building |
| `indoor/graph.py` | `IndoorGraph` (walk network) and `Zoning` (zone inference) |
| `indoor/route.py` | `Navigator`: zone policy, routing, landmark narration |
| `indoor/venue.py` | **All venue-specific knowledge.** Sites, zones, seeds, barriers, portals |
| `scripts/build.py` | Fetch + build + zone report + policy smoke checks |
| `scripts/export_web.py` | Export a compact JSON bundle for the browser |
| `scripts/build_web.py` | Assemble `web/index.html` (self-contained, no server) |
| `web/01-core.js` | JS port: graph, Dijkstra, zone policy |
| `web/02-narrate.js` | JS port: landmark narration |
| `web/03-ui.js` | Terminal tabs, search, floor plan |
| `tests/test_policy.py` | Zone-policy regressions — the safety-critical ones |
| `docs/` | Architecture, data, status, roadmap, decisions |

## Concepts you must understand before changing anything

- **Site** — a physically separate building (Terminal 1, Terminal 2). Each has
  its own graph. **No edge ever crosses sites.** Which site a feature belongs to
  is decided by its `building:ref` tag, *not* by which venue's tiles it came from.
- **Zone** — `landside-dep`, `airside-dep`, `arrivals`, `public`. Assigned to
  every walk node by inference, because the source data does not encode it.
- **Seed** — a POI that can only exist in one zone (a boarding gate is airside).
  Seeds anchor zone labels, which then grow through the walk network.
- **Barrier** — a control point (`aeroway=security`). Zone growth cannot pass
  through it. Barrier nodes become portal nodes.
- **Portal** — a *directed* legal crossing between two zones. Landside to airside
  through security is legal and becomes a visible step; the reverse is not.
- **Landmark score** — not every POI is usable. Branded retail scores highest,
  facilities mid, and benches / drinking fountains / art installations score
  zero. You cannot navigate by a bench.

## Rules

1. **Venue knowledge belongs only in `indoor/venue.py`.** If you find yourself
   writing `if terminal == 'T2'` or `if level == '3'` anywhere under `indoor/`
   other than `venue.py`, stop — it belongs in config. Supporting a new building
   must mean writing a `VenueConfig`, not editing the engine.
2. **The zone tests are safety tests.** `tests/test_policy.py` encodes real
   passenger journeys. Telling someone to walk from arrivals into a departure
   gate is a real-world failure, not a cosmetic bug. Run the tests before you
   push, and if you change zoning, add a case rather than relaxing one.
3. **Reachability is predicted, not searched.** `Navigator.reachable()` (and
   `Site.reach()` in the browser) answers "can I get there?" by component
   arithmetic plus the zone policy, so the picker can mark every candidate on
   each keystroke. It **must** agree with `plan()`/`directions()` — a wrong
   marker is worse than no marker, and `test_reachable_agrees_with_directions`
   enforces it. If you change zoning or portals, keep both in step.
4. **The Python and JS narrators are duplicate implementations** (`indoor/route.py`
   and `web/02-narrate.js`). If you change instruction logic in one, change it in
   the other, or the demo and the engine will disagree. Unifying them is a
   candidate task — see `docs/ROADMAP.md`.
5. **Do not soften the honest limitations** in `docs/STATUS.md`. Zone inference
   is a heuristic on sparse data. When you fix one, update the doc; do not delete
   a limitation that still exists.
6. **Prefer fixing data quality over special-casing.** Most bad instructions
   trace back to the walk network or the POI tags, not to the narrator.

## Gotchas that already cost real debugging time

Full detail with symptoms and fixes in `docs/DATA.md`. The short list:

- De-duplicating tile features by id **drops half of every clipped corridor**.
- Many lifts and stairs have **single-point geometry**; a `len(pts) >= 2` filter
  silently deletes every floor connector.
- Terminal bounding boxes **overlap** — the venue id does not tell you the terminal.
- The walk network **fragments at doorways** (65 components in T2). `graph.stitch(8.0)`
  bridges sub-8 m gaps and is what makes check-in reach security at all.
- Walk components are **not** zones — T2's largest component contains gates,
  baggage claim and check-in together. This is exactly why zoning exists.

## Working in parallel

Several people and Claude instances work here at once. Before starting:

1. Read `docs/ROADMAP.md` and pick a workstream. Each names the files it **owns**
   and the files it **must not touch**.
2. Branch: `git checkout -b <stream>/<short-description>`.
3. `indoor/venue.py` is the one file everyone touches — keep edits there small
   and easy to review.
4. Run `.venv/bin/python -m pytest tests/ -q` before pushing.
5. If you close out a known limitation, update `docs/STATUS.md` in the same PR.

## Verifying you have not broken anything

```bash
.venv/bin/python -m pytest tests/ -q     # must stay green
python3 scripts/build.py                 # zone counts should not swing wildly
```

`scripts/build.py` prints a per-terminal zone report and runs five policy checks.
Two of them must print `BLOCKED` — that is the system working, not failing.

The same is true in the UI: the search picker marks unreachable places with an
icon while you type — a red no-entry for "the venue's rules forbid this" and a
grey broken-link for "our map has no route". Those markers appearing is the
system working.
