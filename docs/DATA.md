# Data

Where the map data comes from, what is in it, and everything non-obvious we
learned the hard way.

---

## Source

Bengaluru Airport's public indoor map at
[bengaluruairport.com/map/1](https://www.bengaluruairport.com/map/1) is
**Woosmap Indoor**, rendered through Mapbox GL. The page loads the Woosmap JS
SDK, which exposes `woosmap.map` with `IndoorService`, `IndoorRenderer`,
`DirectionsService` and friends.

The data behind it is a documented REST API at `https://api.woosmap.com`.

### Endpoints

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /indoor/venues` | Works | Lists venues with `venue_id`, `name`, `bbox`. |
| `GET /indoor/venues/{id}` | Works | Venue detail: levels, buildings, `routing_profiles`, `categories`. |
| `GET /indoor/venues/{id}/tiles/{z}/{x}/{y}.pbf` | Works | Mapbox Vector Tiles. **This is where all the real data lives.** |
| `GET /indoor/style` | Works | Layer styling only — 17 layers, no data sources. |
| `GET /indoor/directions/json` | Exists, 404s for BLR | See below. |

```bash
curl -H "Referer: https://www.bengaluruairport.com/" \
  "https://api.woosmap.com/indoor/venues?key=$WOOSMAP_KEY"
```

### Why we route ourselves

`/indoor/directions/json` is a real endpoint — it validates parameters and tells
you the accepted position formats (`lat,lng,level`, a POI id, or a reference).
But every routing request for BLR returns `404 {"detail": "Not Found"}`.

The reason is in the venue detail:

```json
{ "venue_id": "bial_t2", "routing_profiles": [], "categories": [] }
```

**Routing is not provisioned on this key.** Woosmap's own wayfinding is a
licensed feature the airport has not enabled. That is why this project builds
its own walk graph from the footway geometry in the tiles and routes with
Dijkstra. It is not a workaround for convenience; there is no routing API to
call.

### Venue ids

| `venue_id` | Use |
| --- | --- |
| `bial_t1` | Terminal 1. |
| `bial_t2` | Terminal 2. |
| `bial` | **Skipped deliberately** — a union venue that duplicates both terminals' features, producing false matches (a T1 KFC against a T2 security gate). `scripts/build.py` filters it out. |
| `gdn` | Gare du Nord. Not ours; confirms the same API serves other venues. |

---

## The API key

The key is **the airport's own public, referrer-restricted site key**. It is
embedded in their page JavaScript and is not a secret in any meaningful sense —
but it is not ours, and this repository is public, so it is **not committed**.

Read it from the environment:

```bash
export WOOSMAP_KEY='woos-...'
export WOOSMAP_REFERER='https://www.bengaluruairport.com/'   # optional, this is the default
python3 scripts/build.py --refresh
```

To obtain it, open [bengaluruairport.com/map/1](https://www.bengaluruairport.com/map/1)
and read it from the loaded SDK config in the browser console:

```js
woosmap.map.config._config.apiKey
```

Requests must send a matching `Referer` header, which `WoosmapSource` does.

For anything beyond a hackathon prototype, get your own Woosmap contract rather
than borrowing the airport's key.

You usually will not need the key at all: `scripts/build.py` caches the fetch to
`data/raw_features.json` (gitignored), and everything downstream works from the
cache. Only `--refresh` hits the network.

---

## Tile data

Tiles are Mapbox Vector Tiles (protobuf), decoded by our own dependency-free
decoder in `indoor/tiles.py`. Everything lives in a single layer named `indoor`.

We harvest at **z17**, which covers each terminal in 15 tiles.

### Tags that matter

| Tag | Values / meaning |
| --- | --- |
| `name` | Display name. Absent on most geometry. |
| `level` | Floor. **May be multi-valued**, e.g. `"0;3"` — that is how a lift or stairwell declares which floors it connects. Always split on `;`. |
| `highway` | `footway` (walkable path), `steps`, `elevator`. This is the routing network. |
| `aeroway` | `gate`, `checkin`, `baggage_claim`, `security`, `airlines_counter`, `baggage_secure_wrap`, `airline_transfers`. **The zone signal.** |
| `shop` | Retail category: `duty_free`, `clothes`, `bakery`, `jewelry`, `art`, ... |
| `amenity` | `cafe`, `restaurant`, `fast_food`, `toilets`, `atm`, `lounge`, `bench`, ... |
| `building:ref` | **The terminal.** Values `bial_t1` and `T2` (inconsistently named). |
| `building:name` | Present on the building outline only. |
| `indoor` | `yes`, `room`, `area`, `level`. |
| `entrance` | `yes` — terminal entrances, used as a portal for public to landside. |
| `oneway` | Directional corridors. Present but not yet used by the router. |
| `conveying` | `forward` — travelators. Present but not yet used. |
| `woosmap:label`, `woosmap:label_id`, `section_number`, `iden` | Provider internals. |

### Scale at z17

| Site | Raw features | Walk nodes | POIs |
| --- | --- | --- | --- |
| T1 | 1629 | 779 | 218 |
| T2 | 2620 | 1375 | 249 |

Feature counts are after filtering by `building:ref`; node and POI counts are
after graph construction, stitching and POI de-duplication.

---

## Gotchas that cost us real debugging time

These are the non-obvious ones. Each cost meaningful time to find, and several
fail *silently* — the code runs, produces plausible output, and is wrong.

### 1. Do not de-duplicate features by id

**Symptom:** corridors mysteriously ended halfway. The walk network was far more
fragmented than the map looked.

**Cause:** a feature crossing a tile boundary is clipped and appears in both
tiles, with the same feature id but different halves of the geometry. Keeping
only the first copy throws away the other half.

**Fix:** keep every tile's copy (`WoosmapSource.features` appends, never
de-duplicates). Overlapping duplicate segments are harmless for routing; missing
halves are not.

### 2. Vector tiles quantise coordinates per tile

**Symptom:** two corridors that clearly meet had no shared node, so the graph
was disconnected there.

**Cause:** MVT coordinates are integers over the tile's `extent` (4096). The
same real-world point encoded in two different tiles lands on slightly different
lon/lat. At z17 the quantisation is roughly 7 cm, but exact-match node joining
still fails.

**Fix:** `IndoorGraph._node()` snaps to any existing node within `TOL_M = 1.5`
metres on the same level.

### 3. Lifts and stairs often have single-point geometry

**Symptom:** no route ever changed floors. Cross-level journeys returned "no
route" even though the map clearly shows lifts.

**Cause:** many `highway=elevator` and `highway=steps` features are a *single
point* with a multi-valued `level` such as `"0;1"`. A reasonable-looking guard
like `if len(pts) < 2: continue` silently deletes every floor connector in the
building.

**Fix:** two passes in `IndoorGraph._build()`. Multi-point features build
horizontal edges as usual; then *all* multi-level features — including
single-point ones — are welded into each level's network by proximity
(`ATTACH_M = 12` m) and linked vertically to each other.

This one is worth remembering as a class of bug: **a filter that looks like it
removes degenerate data can remove an entire category of real data.**

### 4. The venue id does not determine the terminal

**Symptom:** routing between two POIs that both "exist in T2" failed, or matched
the wrong building entirely.

**Cause:** the two venues' bounding boxes overlap. `bial_t2`'s tiles contain
about 50 named T1 POIs, and `bial_t1`'s contain 11 from T2. Fetching venue
`bial_t2` does **not** give you Terminal 2.

**Fix:** group by the `building:ref` tag on each feature, via `Site.match` in
`indoor/venue.py`. Note the values are inconsistently named — `bial_t1` for one
terminal and `T2` for the other — so the predicate accepts both spellings.

### 5. The walk network fragments at doorways

**Symptom:** check-in could not reach *any* security POI, so the entire
landside-to-airside journey was unroutable.

**Cause:** T2's network came out as **65 disconnected components**. Corridors end
a few metres short of each other at doorways and tile seams.

**Fix:** `IndoorGraph.stitch(8.0)` repeatedly bridges the closest pair of nodes
from two different components on the same level, while the gap is under the
threshold.

| Threshold | Bridges | Components | Largest | check-in reaches gates? |
| --- | --- | --- | --- | --- |
| none | 0 | 65 | 790 | no |
| 4 m | 24 | 41 | 818 | no |
| 6 m | 46 | 19 | 979 | no |
| **8 m** | **55** | **10** | **1333 (97%)** | **yes** |

> **Keep the threshold small.** 8 m is defensible for airport corridors, which
> are wide. A larger value will punch through walls and invent routes that do not
> exist. If you raise it, verify the resulting bridges against a floor plan.

### 6. Walk components are not zones

**Symptom:** the router happily walked a passenger from a baggage belt to a
departure gate.

**Cause:** we initially hoped physical separation would already be encoded in
the graph's connected components. It is not. T2's largest component contains
`gate` (airside), `baggage_claim` (arrivals) **and** `checkin` (landside) all
mutually reachable.

**Fix:** the explicit zone model — seeds, barriers and directed portals. See
`docs/ARCHITECTURE.md`. This gotcha is the entire reason that model exists.

### 7. The building outline is not a place

**Symptom:** instructions read "walk past Kempegowda International Airport -
Terminal 2 on your left", which is useless.

**Cause:** the building outline and the per-level polygons carry the venue's own
name, and they are large enough to sit near any path.

**Fix:** `pois_of()` skips features tagged `indoor=level` or carrying
`building:name`.

---

## Known data limitations

Things that are genuinely missing from the source, not bugs in our code:

- **No landside/airside labelling.** Zones are inferred. See the warning in
  `docs/ARCHITECTURE.md`.
- **No flight context.** Portal choice is by distance, so a domestic check-in to
  domestic gate route may pick *International Security* simply because it is
  nearer.
- **T1 has no mapped exit gates**, so the `arrivals -> public` portal has zero
  candidates there and arriving T1 passengers cannot be routed out.
- **Some POIs remain unzoned** (7 in T2 at last build) because they snap to
  nodes no seed reached.
- **`oneway` and `conveying` are present but unused.** Directional corridors and
  travelators are in the data and could improve realism.
