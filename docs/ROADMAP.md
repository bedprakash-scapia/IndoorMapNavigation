# Roadmap and Parallel Workstreams

This project is structured so several people — or several Claude sessions — can work
at the same time without colliding. Each workstream below names the files it owns,
the files it must leave alone, and what "done" concretely means.

**Before starting any stream, read [STATUS.md](STATUS.md).** Several streams exist
specifically to fix limitations recorded there.

---

## Stream overview

| # | Stream | Owns | Priority |
|---|---|---|---|
| 1 | Zone accuracy | `indoor/venue.py`, `Zoning` in `indoor/graph.py`, `data/zones/` | High — safety-relevant |
| 2 | Walk-network quality | `IndoorGraph` in `indoor/graph.py` | High |
| 3 | Narration quality | `indoor/route.py`, `web/02-narrate.js` | Medium |
| 4 | Web app / UX | `web/*` | Medium |
| 5 | New venues | additions to `indoor/venue.py` | Medium — proves genericity |
| 6 | Accessibility routing | `shortest()` in `indoor/graph.py`, `indoor/route.py` | Medium |

---

## 1. Zone accuracy

Replace inferred zone labels with explicitly drawn, reviewed zone boundaries. This
is the highest-value stream because zone correctness is the system's safety property
and it currently rests on four security POIs per terminal.

**Owns**
- `indoor/venue.py` — the `Zone`, `Seed`, `Barrier`, `Portal` config types
- `indoor/graph.py` — the `Zoning` class only
- `data/zones/` — new directory for polygon definitions

**Do not touch**
- `IndoorGraph` in `indoor/graph.py` (stream 2 owns it)
- `indoor/route.py` — consume `poi['zone']`, do not change how it is used
- `web/*`

**Done when**
- Zone membership comes from explicit polygons per (site, level), not seed growth
- Zero POIs land in no zone across both terminals
- Seed-and-grow survives as a fallback for venues without hand-drawn polygons
- A reviewer who knows the building has signed off on the T2 boundaries

**First step**
Export the current inferred zone assignment to GeoJSON, one file per (site, level),
and open it over the floor plan. The mislabelled POIs will be visible immediately and
tell you where the boundaries actually need to sit.

---

## 2. Walk-network quality

Validate and tune the component stitching that makes cross-terminal-area routing
possible at all.

**Owns**
- `indoor/graph.py` — `IndoorGraph` only (`_build`, `stitch`, `snap`, `shortest`)

**Do not touch**
- The `Zoning` class (stream 1 owns it)
- `indoor/venue.py`
- `indoor/route.py`

**Done when**
- Each stitched bridge is checked against building geometry (wall and room polygons
  are present in the source features) and bridges that cross a wall are rejected
- The 8 m threshold is justified by measurement rather than chosen by trial
- A report lists every bridge with its length and what it connects, so a human can audit it
- Remaining disconnected components are enumerated with a reason for each

**First step**
Have `stitch()` return the list of bridges it created rather than just a count, then
render them over the floor plan. Anything crossing a room boundary is a candidate
false bridge.

---

## 3. Narration quality

Improve the readability of generated instructions, especially where landmarks are
sparse.

**Owns**
- `indoor/route.py` — `Navigator` narration methods
- `web/02-narrate.js`

**Do not touch**
- `indoor/graph.py`
- `indoor/venue.py` (unless adding phrasing config, which must be reviewed)

> **The Python and JavaScript narrators are duplicate implementations of the same
> algorithm.** `indoor/route.py` and `web/02-narrate.js` must be kept in sync by
> hand. Any change to one needs the same change in the other, verified by comparing
> output on the same route. **Unifying them is itself a candidate task for this
> stream** — either compile the Python to JS, move narration server-side, or
> designate one as canonical and generate the other.

**Done when**
- No route emits more than two consecutive turn-only steps without a landmark
- Landmark selection prefers landmarks the user will pass *ahead* of the turn rather
  than the nearest by raw distance
- Python and JS produce identical instructions for a fixed set of test routes
- Regional-language phrasing is supported. The Google Maps India work this design is
  based on shipped voice guidance in Hindi, Tamil and Bengali; landmark navigation
  without local-language output only solves half the problem

**First step**
Write a test that routes 50 POI pairs and counts consecutive bare turns. That number
is the metric this stream drives down.

---

## 4. Web app / UX

**Owns**
- `web/*` — all HTML, CSS and JavaScript, and the bundling script

**Do not touch**
- `indoor/*` — if the app needs different data, request a change to
  `scripts/export_web.py` rather than editing the engine
- `web/02-narrate.js` while stream 3 is active on it (coordinate first)

**Done when**
- Rendering is verified locally and the intermittent blank-paint behaviour recorded
  in STATUS.md is either reproduced and fixed or shown to be a capture artefact
- The data bundle is loaded rather than inlined, or is demonstrably fine inlined
- Mobile layout works — this is a phone use case in reality
- Blocked routes explain the zone rule in a way a passenger understands

**First step**
Serve the built page from a local HTTP server and confirm first-paint behaviour with
the network throttled. That settles the open rendering question.

---

## 5. New venues

Prove the engine is genuinely venue-agnostic by adding a second venue.

**Owns**
- Additions to `indoor/venue.py` — a new `VenueConfig` only

**Do not touch**
- The existing `BLR` config
- `indoor/graph.py`, `indoor/route.py`, `indoor/source.py` — if a new venue *requires*
  an engine change, that is a finding worth reporting, because it means venue-specific
  logic leaked into the engine

**Done when**
- **Gare du Nord** (`gdn`) routes end to end. It is present in the same Woosmap
  account as the BLR venues and is a train station, so it exercises a completely
  different zone model — platforms and concourse rather than airside and landside
- No file outside `indoor/venue.py` needed changing, or the required changes are
  documented as genuine engine gaps
- `docs/ARCHITECTURE.md` gains a short section on writing a `VenueConfig` for a new
  building type

**First step**
Call `WoosmapSource.venues()` and inspect `gdn`'s tag vocabulary. The zone model
follows from what tags actually exist, not from what an airport needed.

---

## 6. Accessibility routing

Add a step-free routing preference. The graph already distinguishes `elevator` from
`steps` edges, so the data is present.

**Owns**
- `indoor/graph.py` — `shortest()` only, to accept an edge filter or cost function
- `indoor/route.py` — surfacing the preference and phrasing lift-only instructions

**Do not touch**
- `IndoorGraph._build` / `stitch` (stream 2)
- The `Zoning` class (stream 1)

**Done when**
- A step-free flag excludes `steps` edges entirely and routes via lifts only
- A route with no step-free option available says so, rather than silently returning
  a route with stairs
- The web app exposes the preference
- Escalator handling is decided explicitly — an escalator is not step-free, and the
  current data does not clearly separate escalators from stairs

**First step**
Count how many level transitions in each terminal are lift-served versus stairs-only.
If lift coverage is poor, this stream's real output may be a data-gap report rather
than a routing feature.

---

## Coordination rules

- **One branch per stream**, named `stream/<n>-<short-name>` — for example
  `stream/1-zone-accuracy`. Do not commit to `main` directly.
- **`indoor/venue.py` is shared.** Streams 1 and 5 both touch it and streams 3 and 6
  may want to. Keep edits there small, single-purpose and reviewed. Never reformat it.
- **Re-run both checks before pushing:**
  ```bash
  python3 -m pytest tests/ -q
  python3 scripts/build.py
  ```
  `scripts/build.py` prints node, POI, component and zone counts. If those numbers
  move and you did not intend it, stop and find out why before pushing.
- **Update [STATUS.md](STATUS.md) when you fix a limitation.** That file is what the
  next person trusts. A fixed limitation left documented as broken wastes someone's
  afternoon; a broken one documented as fixed is worse.
- **Report engine leakage.** If your stream cannot do its job without editing a file
  it does not own, that is useful information about the architecture — record it in
  the PR rather than quietly reaching across the boundary.
