# Decision log

Why things are the way they are. Append new entries; do not rewrite old ones.
If a decision is reversed, add a new entry that supersedes it.

---

## D1 — Route ourselves rather than use the provider's routing API

**Context.** Woosmap Indoor exposes `/indoor/directions/json`, which would have
given us routing for free.

**Finding.** It returns 404 for every BLR request. The venue reports
`routing_profiles: []` — routing is not provisioned on this key.

**Decision.** Build our own router over the footway network in the tiles
(`highway=footway|steps|elevator`, plus multi-level tags like `level="0;3"` that
mark floor connectors).

**Consequence.** We own routing quality, which turned out to be necessary anyway:
the provider's API would not have enforced zones (D4).

---

## D2 — Landmarks, not distances, are the instruction

**Context.** The first working narrator emitted "Walk 59 m, then turn left."

**Decision.** Anchor every instruction on something visible, after the model
Google used for India, where street names are often useless but "past the temple,
turn right where the mango seller sits" is how directions are actually given.
Distance is demoted to a parenthetical hint.

**Consequence.** POIs need a usability score. Branded retail scores 6, generic
category labels 3, facilities 4, everything else 2, and street furniture — benches,
drinking fountains, waste bins, and BLR's 126 art installations — scores 0. You
cannot navigate by a bench.

Three follow-on rules came from real bad output:

- The same landmark must not be named twice ("Bear right at Johnny Rockets, walk
  past Johnny Rockets").
- Origin and destination may never anchor their own route (KFC signposting KFC).
- In landmark-sparse areas, re-using a landmark and saying "towards X" beats
  emitting a bare "turn left". Seven consecutive unanchored turns in the baggage
  hall is what forced this.

---

## D3 — Terminals are decided by `building:ref`, not by venue id

**Context.** Routes were mixing Terminal 1 and Terminal 2.

**Finding.** The venues' bounding boxes overlap. `bial_t2`'s tiles contain about
50 named T1 POIs, and `bial_t1`'s contain 11 from T2. There is also a third venue,
`bial`, which is a union of both terminals and duplicates everything.

**Decision.** Model buildings as `Site` objects selected by each feature's own
`building:ref` tag. Skip the `bial` union venue entirely. Each site gets its own
graph and no edge ever crosses sites.

**Consequence.** A cross-terminal route cannot be constructed at all, rather than
being constructed and then filtered. `tests/test_policy.py` asserts no feature
leaks across terminals.

---

## D4 — Zones are inferred by seed-and-barrier propagation

**Context.** Routes were walking passengers from a baggage belt to a departure
gate.

**Finding.** We first checked whether the walk graph's connected components
already separated zones. They do not: Terminal 2's largest component contains
`gate` (airside), `baggage_claim` (arrivals) and `checkin` (landside) all mutually
reachable. The published data has no airside/landside encoding whatsoever.

**Options considered.**

1. *Level-based rules* — rejected: the airside/landside split is horizontal, not
   vertical, and T2 has gates on levels 0, 1 and 3.
2. *Connected components as zones* — rejected by the finding above.
3. *Explicit zone polygons* — correct, but we do not have them.
4. *Seed and barrier propagation* — chosen.

**Decision.** Seed zone labels from POIs that can only exist in one zone
(gate → airside, check-in → landside, baggage belt → arrivals, taxi → public),
grow them through the walk graph by distance, and refuse to grow through a
barrier POI (`aeroway=security`). Barrier nodes become portals. Crossings are
declared per venue and are *directed*.

**Consequence.** This is a heuristic on sparse data and it is safety-relevant —
Terminal 2 has only four security POIs acting as barriers for the entire
building. Option 3 remains the right long-term answer; the config structure
already supports it. Illegal crossings are refused with a reason rather than
routed around, because silently rerouting would hide the problem.

---

## D5 — Bridge doorway-sized gaps in the walk network

**Context.** Check-in could not reach *any* security POI, so the legal
landside → airside journey was impossible.

**Finding.** The walk network fragments at doorways and tile seams — 65
disconnected components in Terminal 2 — with many gaps of only 2–8 m.

**Decision.** `IndoorGraph.stitch(8.0)` repeatedly bridges the closest
sub-threshold pair of components on the same level.

**Result.** T2 goes from 65 components to 10, with the largest covering 97% of
nodes. Check-in reaches security and the gates.

**Risk, accepted knowingly.** 8 m is generous and could in principle bridge
through a thin wall. Nothing validates bridges against building geometry. This is
tracked as a limitation in `docs/STATUS.md` and as a workstream in
`docs/ROADMAP.md`.

---

## D6 — Keep the engine venue-agnostic

**Decision.** Everything BLR-specific lives in `indoor/venue.py` as declarative
config: sites, zones, seeds, barriers, portals. Provider specifics live behind a
`Source` class. Supporting a new building means writing a `VenueConfig`; supporting
a new data provider means writing a `Source`.

**Consequence.** No `if terminal == 'T2'` anywhere under `indoor/` outside
`venue.py`. `gdn` (Gare du Nord) exists in the same Woosmap account and is the
obvious test of whether this held.

---

## D7 — The demo is a single self-contained file

**Decision.** `web/index.html` embeds its data and runs with no server, no build
step and no network.

**Consequence.** The JS duplicates the Python narrator. This is a known hazard:
change one and you must change the other, or the demo and the engine disagree.
Unifying them is a candidate task in `docs/ROADMAP.md`.

---

## D8 — The API key is not committed

**Context.** This repository is public. The Woosmap key is the airport's own
public, referrer-restricted site key — it is not ours to redistribute.

**Decision.** Read it from `WOOSMAP_KEY`. Commit the fetched data
(`data/raw_features.json`) instead, so the whole project builds, tests and runs
offline without anyone needing the key.
