# IndoorMapNavigation

Indoor wayfinding that gives directions the way people actually give them —
anchored on landmarks you can see, not on distances.

```
Stand at Domestic Security with it behind you, facing Domestic Buggy Point.
Walk past Hugo Boss on your right.                              (61 m)
Turn right at P.F. Chang's.
Walk past Giraffe World Kitchen on your right.                  (69 m)
Take the lift beside Johnny Rockets down to Level 0.
KFC is right there, next to Gate D19.
```

The first venue is Bengaluru Airport (BLR), built on the airport's own published
indoor map. The engine itself contains no BLR knowledge — a new building means
writing a config, not editing the engine.

## Why it is not just shortest-path

**Directions name places, not metres.** People navigate by "turn left at the
coffee shop", so distance is a parenthetical hint and the landmark is the
instruction. Not every point of interest works as a landmark, either — branded
shops are memorable, benches and drinking fountains are not, and the engine
scores them accordingly.

**An airport is not one navigable space.** A boarding gate is airside, a check-in
desk is landside, a baggage belt is arrivals. You can only move between them
through a control point, in one direction. The router enforces this:

| Journey | Result |
|---|---|
| Check-in → departure gate | Allowed, with `Clear International Security` as an explicit step |
| Baggage belt → departure gate | **Refused** — not connected for passengers |
| Departure gate → check-in | **Refused** — security is one-way |
| Baggage belt → baggage belt | Allowed, same zone |

Terminals are separate too: T1 and T2 have independent walk networks with no edge
between them, so a cross-terminal route cannot be constructed at all.

## Quickstart

```bash
python3 -m venv .venv && .venv/bin/pip install pytest
.venv/bin/python -m pytest tests/ -q      # 13 tests, no network needed

python3 scripts/build.py                  # zone report + policy checks
python3 scripts/export_web.py             # data bundle for the browser
python3 scripts/build_web.py              # web/index.html — open it directly
```

Pure standard-library Python; `pytest` is the only dependency and only for tests.
A cached fetch is committed, so all of the above works offline. Re-fetching needs
`WOOSMAP_KEY` — see [docs/DATA.md](docs/DATA.md).

## Where to look

| Doc | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Start here. How to work in this repo, concepts, rules, gotchas |
| [docs/STATUS.md](docs/STATUS.md) | What works today and what does not — read before trusting anything |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Parallel workstreams, file ownership, how not to collide |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engine design and the zone-inference algorithm |
| [docs/DATA.md](docs/DATA.md) | Where the map data comes from and its many traps |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things are the way they are |

## Honest status

This is a working prototype, not a production system. The source map does not
label airside or landside, so **zones are inferred heuristically** from POIs that
can only exist in one zone. That inference is safety-relevant and imperfect:
Terminal 2 has only four security POIs acting as barriers for the whole building.
Portal choice has no flight context. `docs/STATUS.md` lists every known
limitation without softening; read it before demoing.

## Contributing

Pick a workstream from [docs/ROADMAP.md](docs/ROADMAP.md) — each names the files
it owns and the files it must not touch, so several people can work at once.
Branch per stream, run the tests before pushing, and update `docs/STATUS.md` when
you close out a limitation.
