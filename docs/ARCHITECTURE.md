# Architecture

How the indoor navigation engine works, for someone who has never seen this code.

The engine answers one question: **given where a person is standing and where they
want to go, what should we tell them?** Two things make that harder than a
shortest-path call:

1. A building is not one navigable region. An airport has zones (landside,
   airside, arrivals) separated by control points you may only cross in one
   direction. A router that ignores this will happily walk an arriving passenger
   back into the departure hall.
2. People do not navigate by distance. They navigate by what they can see.
   "Turn left at Costa Coffee" beats "turn left in 40 m".

Everything below is generic. **All venue-specific knowledge lives in exactly one
file: `indoor/venue.py`.** If you find yourself adding an airport concept to
`graph.py` or `route.py`, stop — it belongs in config.

---

## Layering

```
indoor/tiles.py     Mapbox Vector Tile decoder (no dependencies)
       |
indoor/source.py    Provider adapter: fetch tiles -> normalised features
       |            Also: split_sites(), pois_of()
       |
indoor/graph.py     IndoorGraph  - the walkable network for ONE site
       |            Zoning       - assigns every node to a zone
       |
indoor/route.py     Navigator    - zone policy (plan) + landmark narration
       |
indoor/venue.py     VenueConfig  - Sites, Zones, Seeds, Barriers, Portals
```

Each layer only knows about the one below it. `venue.py` sits to the side: it is
data that `graph.py` and `route.py` consult, never code they are coupled to.

---

## Module reference

### `indoor/tiles.py`

A minimal, dependency-free Mapbox Vector Tile (protobuf) decoder. We wrote our
own because `mapbox_vector_tile` pulls in protobuf and we only need four things
per feature: id, tags, geometry type, and points.

Public surface:

| Function | Purpose |
| --- | --- |
| `decode_tile(buf, x, y, z)` | Returns `{layer_name: [feature, ...]}`. Each feature is `{'id', 'type', 'props', 'pts'}` with `pts` already projected to `(lon, lat)`. |

Geometry is decoded straight to WGS84 using the tile's `extent` (default 4096)
and the tile's `x/y/z`. Note that multi-part geometries are flattened into a
single point list — adequate for our use (we only need footway vertices and POI
centroids) but worth knowing if you start doing polygon work.

### `indoor/source.py`

Adapters that fetch a venue's map and normalise it. The normalised feature
schema is the contract with everything downstream:

```json
{
  "id": 9489399,
  "name": "Qmin",
  "level": "3",
  "levels": ["3"],
  "cat": "restaurant",
  "tags": { "...raw provider tags..." },
  "pts": [[77.7154331, 13.1988684], "..."]
}
```

| Symbol | Purpose |
| --- | --- |
| `WoosmapSource(key, referer)` | Woosmap Indoor provider. `.venues()`, `.features(venue_id, bbox, z=17)`. |
| `split_sites(features, cfg)` | Groups features by `Site`, using `cfg.site_of(tags)`. |
| `pois_of(features)` | Named features de-duplicated by `(name, level)`, with centroid. |
| `centroid(pts)` | Mean of the points. |

**To support a different provider, write another Source class that emits the
schema above.** Nothing downstream changes.

`pois_of()` deliberately drops features tagged `indoor=level` or carrying
`building:name` — those are the building outline and per-level polygons, which
carry the venue's own name and are not places you can walk to.

### `indoor/graph.py`

No venue knowledge at all. Two classes.

**`IndoorGraph(features)`** — the walkable network for one site.

| Member | Purpose |
| --- | --- |
| `nodes` | List of `(lon, lat, level)`. |
| `adj` | `{node: {node: (weight_m, kind)}}`. |
| `by_level` | `{level: [node, ...]}` for connected nodes. |
| `comp` | `{node: component_representative}`. |
| `stitch(max_gap=6.0)` | Bridges same-level gaps between components. Returns bridge count. |
| `xy(n)`, `level(n)` | Accessors. |
| `snap(pt, lv)` | Nearest connected node on a level. Returns `(node, metres)`. |
| `shortest(a, b, allowed=None)` | Dijkstra. Returns `{'path': [...], 'm': metres}` or `None`. |

Construction is two passes. First, every `highway` in `('footway', 'steps',
'elevator')` with at least two points becomes edges on each of its levels.
Second, multi-level features (`level` values like `"0;3"`) become vertical
connectors: the shaft is anchored at `pts[0]`, welded into each level's network
if a node is within `ATTACH_M` (12 m), then linked vertically with a fixed cost
(25 m-equivalent for a lift, 20 for stairs) to represent wait and transit time.

Two constants govern how forgiving the graph is:

- `TOL_M = 1.5` — nodes within this distance on the same level are the same
  node. Necessary because vector tiles quantise coordinates per tile.
- `ATTACH_M = 12.0` — how far a vertical connector may reach to join a level.

**`Zoning(graph, pois, cfg, barrier_radius=14.0)`** — assigns every node a zone.
Detailed below.

| Member | Purpose |
| --- | --- |
| `zone` | `{node: zone_id}`. |
| `portal_nodes` | `{node: poi}` — nodes at a control point. |
| `inferred` | Set of nodes labelled by the fallback pass, not by direct growth. |
| `of(node)` | Zone id for a node. |
| `portals_for(portal_cfg, pois)` | POIs that can serve a configured crossing. |

### `indoor/route.py`

`Navigator(graph, pois, zoning, cfg, site_name)` — routing and narration.

| Method | Purpose |
| --- | --- |
| `plan(origin, dest)` | Resolves the legal zone sequence. Returns legs or a refusal with a reason. |
| `directions(origin, dest)` | Full result: steps, metres, levels, landmarks, zones, minutes. |
| `near(pt, lv, radius, ex, zone)` | Landmarks near a point, best first. |
| `corner(pt, lv, used, radius, recent, never, zone)` | Anchor for a turn, with escalating radius. |
| `along(pts, lv, used, limit, never, zone)` | Landmarks flanking a straight run, with side. |

The constructor snaps every POI to a node, scores it as a landmark, and buckets
the usable ones by level.

### `indoor/venue.py`

Declarative config only. See the domain model below.

---

## Domain model

### Site

A physically separate building — a terminal, a wing, a mall block.

```python
Site('T2', 'Terminal 2', lambda t: t.get('building:ref') in ('bial_t2', 'T2'))
```

Each site gets its own `IndoorGraph`. **No edge ever crosses a site boundary**,
so a cross-site route cannot be constructed at all — it is structurally
impossible rather than merely refused. This is the right model: two terminals
200 m apart with no indoor connection are not one navigable space.

The `match` predicate takes raw provider tags. It matters that this is a tag
test and not a venue id or a bounding box — see `docs/DATA.md`, gotcha 4.

### Zone

A region within a site that a person can move around freely.

```python
Zone('airside-dep', 'Departure Gates', 'After security')
```

`short` is the badge text in the UI ("After security"); `name` is the full label.

### Seed

A tag pattern for POIs that can only exist in one zone. These anchor the
inference.

```python
Seed('airside-dep', 'aeroway', 'gate')
```

The BLR seeds and their logic:

| Seed tag | Zone | Why it can only be there |
| --- | --- | --- |
| `aeroway=gate` | `airside-dep` | A boarding gate is past security by definition. |
| `aeroway=checkin` | `landside-dep` | You check in before security. |
| `aeroway=airlines_counter` | `landside-dep` | Same. |
| `aeroway=baggage_secure_wrap` | `landside-dep` | Bag wrapping happens before you drop it. |
| `aeroway=baggage_claim` | `arrivals` | A belt only exists in arrivals. |
| `public_transport=taxi` | `public` | The forecourt is open to everyone. |

### Barrier

A POI that zone growth may not spread through — the physical control point.

```python
Barrier('aeroway', 'security')
```

### Portal

A legal, **directed** crossing between two zones. Direction is the whole point:
landside to airside is possible, airside to landside is not.

```python
Portal('landside-dep', 'airside-dep',
       verb='Clear **{name}** — have your boarding pass and ID ready.',
       via_tag=('aeroway', 'security'),
       note='One-way: you cannot return landside after security.')
```

- `verb` — how the crossing is announced. `{name}` is the barrier POI actually
  chosen.
- `via_tag` / `via_names` — which POIs can serve this crossing.
- `note` — surfaced under the step in the UI.

A crossing with no `Portal` is refused.

---

## Zone inference

The published map does not label airside or landside. Neither do walk
components — T2's largest component contains gates, baggage belts and check-in
desks all mutually reachable, which is exactly the problem the zone model
exists to solve. So zones are inferred, in three phases.

**Phase 1 — mark barriers.** For each POI matching a `Barrier`, snap it to a
node (rejecting snaps beyond 30 m). Then every connected node on that level
within `barrier_radius` (14 m) becomes a portal node, mapped to that POI. A
radius is used rather than a single node because a security hall is wide and a
single node would be trivially routed around.

**Phase 2 — seed and grow.** For each POI matching a `Seed`, snap it and record
`(node, zone)`. Portal nodes are excluded from seeding. Then run a multi-source
Dijkstra from all seeds at once, keyed by graph distance: the nearest seed by
walking distance wins each node.

The critical line is that growth **stops at a portal node**. A portal node
receives a zone label itself, but its neighbours are never enqueued from it.
That is what keeps airside labels from leaking through security into the
check-in hall.

**Phase 3 — fallback for walled-off regions.** Some nodes end up unreachable
from any seed because barriers cut them off. A second Dijkstra, this time
ignoring barriers, labels them from the nearest already-labelled node. These
nodes are recorded in `Zoning.inferred` so their lower confidence is visible.
Without this pass, whole corridors would be unroutable rather than merely
uncertain.

Finally `_assign_pois()` writes `poi['zone']` and `poi['is_portal']`.

> **This is a heuristic, and it is safety-relevant.** T2 has only four security
> POIs acting as barriers for an entire terminal. For production you would draw
> zone boundaries as explicit polygons and have someone who knows the building
> review them. The config structure already supports that; we simply do not have
> the polygons.

---

## Routing

`Navigator.plan(origin, dest)` decides what is legal before any path is
computed.

- **Same zone** (or either zone unknown): one leg, direct.
- **Different zones, a `Portal` exists**: the route is split into two legs
  through a portal POI. Candidates are all POIs that can serve the crossing;
  the chosen one minimises `shortest(origin, portal) + shortest(portal, dest)`.
  Returns `legs = [(origin, portal, portal_cfg), (portal, dest, None)]`.
- **Different zones, no forward `Portal`**: refused, with a reason that
  distinguishes two cases. If the reverse portal exists, the message says the
  control point only works the other way. Otherwise it says the zones are not
  connected for passengers.
- **Portal exists but is unreachable**: refused with that reason, rather than
  silently falling back to an illegal path.

`directions()` then walks the legs, narrating each and appending the portal step
between them. The `closing` flag ensures only the final leg emits an arrival
line — otherwise the route would announce "You have arrived" at the security
gate.

The result:

```json
{
  "steps":  [{"t": "start|walk|turn|level|portal|end", "html": "...", "d": "61 m", "note": "..."}],
  "m": 690.0,
  "levels": ["3"],
  "landmarks": ["...POIs referenced..."],
  "zones": ["landside-dep", "airside-dep"],
  "minutes": 9
}
```

A refusal returns `{'error': reason, 'blocked': True, 'from_zone', 'to_zone'}`.

---

## Landmark narration

### Scoring

Not every POI makes a usable landmark. You cannot navigate by a bench.

| Score | Category | Examples |
| --- | --- | --- |
| 6 | `BRAND` with a proper name | Costa Coffee, Hugo Boss, P.F. Chang's |
| 3 | `BRAND` with a generic name | a POI literally called "Restaurant", "Cafe", "Duty Free" |
| 4 | `FUNC` | toilets, ATM, security, gate, lounge, baggage claim |
| 2 | anything else named | |
| 0 | `NOISE` | bench, drinking water, charging station, planter, artwork |

Names beginning `art by` or `art display` are also scored 0. BLR's data contains
126 art installations; they are invisible as wayfinding cues and would otherwise
dominate, since they sit right along the corridors.

Only POIs scoring above 0 enter the landmark index.

### Path simplification

Raw graph paths zigzag, especially around lifts, and every jitter would become a
spurious "turn left". Two passes fix this:

1. `rdp(pts, eps=4.0)` — Douglas–Peucker at 4 m.
2. `thin(pts, min_seg=7.0)` — drop vertices that would create a run shorter than
   7 m, since a sub-7 m run is not worth an instruction. A trailing stub shorter
   than the threshold is also collapsed.

`_straights()` then cuts the simplified polyline at every turn of 30° or more,
yielding straight runs with their lengths.

### Turn thresholds

| Angle | Phrasing |
| --- | --- |
| below 14° | no turn instruction |
| 14°–29° | "Bear left/right" |
| 30°–104° | "Turn left/right" |
| 105° and above | "Turn sharply left/right" |

### Anchoring, and not repeating yourself

Three sets govern which landmark is used where:

- **`never`** — origin and destination names, plus every leg endpoint. **A place
  is never used as its own landmark.** Without this the router produced "Walk
  past KFC on your left … KFC is right there", which is absurd.
- **`used`** — everything named so far this route. Preferred exclusion, so each
  landmark is mentioned once.
- **`recent`** — the last landmark named, used to avoid naming the same thing in
  two consecutive steps when re-use is unavoidable.

`corner()` escalates rather than going silent. It tries radius 22 m, then 44 m,
then 66 m against `used`. If nothing fresh is found it repeats the escalation
allowing re-use (still excluding `never` and `recent`). The phrasing reflects
what happened:

| Situation | Phrasing |
| --- | --- |
| fresh landmark within 22 m | "Turn left **at** Costa Coffee." |
| fresh landmark found only at 44–66 m | "Turn left, **towards** Belt 3." |
| re-used landmark | "Turn left **just after** Gate C4." |
| nothing at all | "Turn left." |

Without the escalation, sparse stretches such as a baggage hall produced seven
consecutive bare "turn left" steps.

`along()` picks the landmarks flanking a run — up to 2 for runs of 70 m or more,
otherwise 1 — within 20 m of the path, and computes which side each is on from
the cross product of travel bearing and landmark bearing. Results are returned
in travel order.

### Orientation

The first step orients the person before they move. It looks for a landmark
within 60 m and within 70° of the initial heading, preferring high scores:

> Stand at **Domestic Security** with it behind you, facing **Domestic Buggy Point**.

If nothing qualifies it falls back to "Start at X."

### Distance

Distance is a parenthetical hint, never the instruction. Runs under 15 m get no
distance at all. This is deliberate: the whole point is that people navigate by
landmarks.

---

## Extending to a new venue

1. **Write a `VenueConfig`** in `indoor/venue.py` and register it in `VENUES`.
   Define your `Site` predicates against whatever tag actually identifies the
   building, your `Zone` list, `Seed` patterns for POIs that can only be in one
   zone, `Barrier` patterns for control points, and directed `Portal` entries
   for every legal crossing.

2. **Implement a `Source`** only if the provider differs. It must emit the
   normalised feature schema from `source.py`. Nothing downstream needs to know.

3. **Do not touch the engine.** `graph.py` and `route.py` contain no venue
   knowledge and should stay that way. If your venue needs behaviour they do not
   have, add it as a config-driven capability, not a special case.

Sanity checks for a new venue:

- Does every site have at least one seed per zone you defined?
- Do the barrier POIs actually cut the network, or can the router walk around
  them? Check `len(Zoning.portal_nodes)` against how wide the control point is.
- How many nodes landed in `Zoning.inferred`? A large fraction means your seeds
  are too sparse.
- Run the policy checks in `scripts/build.py` with journeys that should be legal
  and journeys that should be refused.
