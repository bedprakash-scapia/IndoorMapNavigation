# Project Status

**Last updated: 2026-08-20**

This document records what is actually built and verified, and what is not. It is
written for a teammate — or a fresh Claude session — picking the project up cold.
Read the limitations section before you trust any output.

---

## What works today

### Landmark-based narration

Turn-by-turn instructions are anchored on visible landmarks rather than distances,
following the Google Maps India model ("turn left at the Costa Coffee", not "turn
left in 40 m"). Distances are emitted as a secondary confirmation only.

A representative route (`Domestic Security` → `KFC`, Terminal 2, 381 m):

```
 1. Stand at Domestic Security with it behind you, facing Domestic Buggy Point.
 2. Walk past Hugo Boss on your right (61 m).
 3. Bear right at Michael Kors.
 4. Walk past Mont Blanc on your left (18 m).
 5. Bear left at Tumi.
 6. Walk past Swarovski on your left, then The Mithai Box on your right (173 m).
 7. Turn right at P.F. Chang's.
 8. Walk past Giraffe World Kitchen on your right (69 m).
 9. Take the lift beside Johnny Rockets down to Level 0.
10. Turn sharply left.
11. KFC is right there, next to Gate D19.
```

Supporting behaviour that is implemented and working:

- **Orientation before movement.** The opening step names a landmark within a 70°
  cone of first travel, so the user knows which way to face.
- **Landmark scoring.** Benches, drinking fountains and the 126 art installations
  score zero and are never used as anchors. Branded retail outranks generic
  category labels.
- **No repetition.** Each landmark is named at most once per route; origin and
  destination are permanently barred from anchoring themselves.
- **Sparse-area fallback.** Where no landmark sits within 22 m the search widens
  to 44 m then 66 m and switches phrasing to "towards X".

### Zone-aware routing

The core correctness property: a route may not silently cross between airside,
landside and arrivals. Crossings happen only through configured portals, in the
configured direction, and become a visible instruction.

Five policy cases are verified in `tests/`:

| From | To | Zones | Result |
|---|---|---|---|
| CheckIn A1 to A15 | Gate C1 | landside-dep → airside-dep | **Allowed**, 690 m, emits `Clear International Security — have your boarding pass and ID ready` |
| Belt 1 | Gate C1 | arrivals → airside-dep | **Blocked** — not connected for passengers |
| Gate C1 | CheckIn A1 to A15 | airside-dep → landside-dep | **Blocked** — control point is one-way |
| Belt 1 | Belt 4 | arrivals → arrivals | **Allowed**, 96 m, same zone |
| Domestic Security | KFC | airside-dep → airside-dep | **Allowed**, 381 m |

### Per-terminal separation

Terminals are separate `Site` objects with separate graphs. There is no edge
between them, so a cross-terminal route cannot be constructed at all.

This matters more than it first appears: the source venue bounding boxes overlap,
so the `bial_t2` tile set contains 50 named Terminal 1 POIs and `bial_t1` contains
11 from Terminal 2. Filtering by venue id is **not** sufficient. Each feature's own
`building:ref` tag decides which terminal it belongs to.

### Browser demo

`web/` builds a self-contained HTML file with both terminals, a searchable POI
picker showing each POI's zone, level switching, and an SVG floor plan with the
route drawn on it. Routing and narration run client-side; the page has no network
dependencies beyond a Google Fonts stylesheet.

---

## Scale

| Site | Walk nodes | Routable POIs |
|---|---:|---:|
| Terminal 1 | 779 | 218 |
| Terminal 2 | 1375 | 249 |

Terminal 2 zone distribution:

| Zone | POIs |
|---|---:|
| `airside-dep` | 160 |
| `public` | 33 |
| `landside-dep` | 28 |
| `arrivals` | 21 |
| *unzoned* | 7 |

---

### Reachability shown while typing (2026-08-21)

The search picker marks every candidate you cannot reach from the other end of
the journey, so a dead end is visible before you choose it rather than after.
Two distinct markers, because they mean different things to a traveller:

| Marker | Meaning |
|---|---|
| Red no-entry | The venue's rules forbid it (wrong zone, or a one-way control point) |
| Grey broken link | No walking route exists in our map data |

Reachable places sort above unreachable ones; nothing is hidden. The prediction
is component arithmetic plus the zone policy rather than a search, so it is
cheap enough to run on each keystroke, and
`test_reachable_agrees_with_directions` asserts it never disagrees with the
router.

## Known limitations

These are real and some of them are safety-relevant. Do not present this system as
production-ready without addressing them.

### Zone inference is a heuristic

The published map data contains **no** airside/landside encoding. Zones are
inferred by seeding from POIs that can only exist in one zone (a boarding gate is
airside, a check-in desk is landside, a baggage belt is arrivals) and growing those
labels through the walk graph until they hit a barrier.

Terminal 2 has only **four** security POIs acting as barriers for the entire
terminal. That is a thin basis for a safety property. Seven Terminal 2 POIs end up
in no zone at all.

Production use needs zone boundaries drawn explicitly as polygons and reviewed by
someone who knows the building. The config structure in `indoor/venue.py` already
supports this; the polygons simply do not exist yet.

### Portal choice has no flight context

The router picks the nearest legal control point by walking distance. On a domestic
check-in → domestic gate route it selected **International Security** because that
was nearest. Correct behaviour requires knowing the passenger's flight, which is not
present in this data and cannot be derived from it.

### Terminal 1 arrivals is a dead end

No exit-gate POIs are mapped in Terminal 1, so the `arrivals → public` portal has
zero candidates there. Arriving Terminal 1 passengers cannot be routed out of
baggage claim. This is a data gap, not a logic error.

### Network stitching is unvalidated

`IndoorGraph.stitch(8.0)` bridges same-level gaps of up to 8 m between walk
components. Without it the published network fragments into 65 components in
Terminal 2 and check-in cannot reach any security POI at all; with it, 10 components
remain and the largest covers 97% of nodes.

But 8 m is generous. Nothing validates a bridge against the building geometry, so a
bridge could in principle pass through a thin wall. No such case has been confirmed
— equally, none has been ruled out.

### Narration degrades where landmarks are sparse

In baggage halls and along long check-in frontage the narrator runs out of distinct
landmarks and falls back to "turn right, towards X" re-using an already-named
landmark. The instructions remain correct but read poorly, and several consecutive
bare turns can appear.

### Web demo rendering is not fully verified

The demo embeds a 143 KB data bundle in a ~176 KB HTML file. Automated screenshots
of the published page intermittently returned blank or half-painted frames. The
routing logic was verified independently in Node and the page was observed fully
rendered, but the paint behaviour was never diagnosed through the sandboxed iframe.

**Verify rendering locally before demoing.**

### No accessibility routing

There is no step-free or lift-only preference. The graph does distinguish `elevator`
from `steps` edges, so the data needed is present — the routing preference simply
has not been built.

---

## How to verify the system still works

Run both before pushing anything:

```bash
# Zone policy and narration regression tests
python3 -m pytest tests/ -q

# Full build: fetch (cached), construct graphs, report scale and zone split
python3 scripts/build.py
```

`scripts/build.py` prints per-site node/POI counts, component counts, bridge counts
and the zone distribution. Compare against the Scale tables above — an unexplained
change in those numbers means something upstream shifted.

The build caches raw features to `data/`. Pass `--refresh` to re-fetch from the
source API.
