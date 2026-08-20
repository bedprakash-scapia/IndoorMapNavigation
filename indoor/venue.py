"""Venue configuration schema.

Everything venue-specific lives here as declarative config; the graph, zoning,
router and narrator below it are generic. To support a new building you write a
VenueConfig — you do not touch the engine.

The central idea is that an indoor space is not one navigable region. It is a
set of ZONES separated by PORTALS you may only cross in certain directions
(security, immigration, boarding). Routing that ignores this will cheerfully
walk an arriving passenger back into the departure hall.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass(frozen=True)
class Site:
    """A physically separate building — a terminal, a wing, a mall block.
    Two sites are never walkable between unless a Portal says so."""
    id: str
    name: str
    match: Callable[[dict], bool]      # raw tags -> belongs to this site?


@dataclass(frozen=True)
class Zone:
    id: str
    name: str
    short: str = ''


@dataclass(frozen=True)
class Seed:
    """Tag pattern that anchors a zone. Nodes nearest these POIs get the label."""
    zone: str
    tag: str                            # which raw tag key
    value: str                          # which value
    level: Optional[str] = None         # optionally restrict to a level


@dataclass(frozen=True)
class Barrier:
    """A POI that zone-propagation may not spread through: the physical control
    point. Nodes at a barrier become portal nodes."""
    tag: str
    value: str


@dataclass(frozen=True)
class Portal:
    """A legal, directed crossing between two zones."""
    frm: str
    to: str
    # how the crossing is announced, {name} = the barrier POI actually used
    verb: str
    # which barrier POIs can serve this crossing (by tag or explicit names)
    via_tag: Optional[tuple] = None      # (key, value)
    via_names: tuple = ()
    note: str = ''


@dataclass
class VenueConfig:
    id: str
    name: str
    sites: list = field(default_factory=list)
    zones: list = field(default_factory=list)
    seeds: list = field(default_factory=list)
    barriers: list = field(default_factory=list)
    portals: list = field(default_factory=list)
    # walking speed used for time estimates, m/s
    speed: float = 1.25

    def site_of(self, tags):
        for s in self.sites:
            if s.match(tags): return s.id
        return None

    def zone(self, zid):
        return next((z for z in self.zones if z.id == zid), None)

    def portal_between(self, a, b):
        return next((p for p in self.portals if p.frm == a and p.to == b), None)


# --------------------------------------------------------------------------
# Bengaluru (BLR) — Kempegowda International Airport
# --------------------------------------------------------------------------
BLR = VenueConfig(
    id='blr',
    name='Kempegowda International Airport, Bengaluru',
    sites=[
        # NB: the two terminals tag themselves inconsistently in the source data.
        Site('T1', 'Terminal 1', lambda t: t.get('building:ref') in ('bial_t1', 'T1')),
        Site('T2', 'Terminal 2', lambda t: t.get('building:ref') in ('bial_t2', 'T2')),
    ],
    zones=[
        Zone('landside-dep', 'Check-in & Departures', 'Before security'),
        Zone('airside-dep',  'Departure Gates',       'After security'),
        Zone('arrivals',     'Arrivals & Baggage',    'Arriving passengers'),
        Zone('public',       'Forecourt & Public',    'Open to everyone'),
    ],
    seeds=[
        Seed('landside-dep', 'aeroway', 'checkin'),
        Seed('landside-dep', 'aeroway', 'airlines_counter'),
        Seed('landside-dep', 'aeroway', 'baggage_secure_wrap'),
        Seed('airside-dep',  'aeroway', 'gate'),
        Seed('arrivals',     'aeroway', 'baggage_claim'),
        Seed('public',       'public_transport', 'taxi'),
    ],
    barriers=[
        Barrier('aeroway', 'security'),
    ],
    portals=[
        Portal('landside-dep', 'airside-dep',
               verb='Clear **{name}** — have your boarding pass and ID ready.',
               via_tag=('aeroway', 'security'),
               note='One-way: you cannot return landside after security.'),
        Portal('public', 'landside-dep',
               verb='Enter the terminal at **{name}**.',
               via_tag=('entrance', 'yes')),
        Portal('arrivals', 'public',
               verb='Exit through **{name}**.',
               via_names=('Immigration & Customs', 'Exit Gate 1', 'Exit Gate 2',
                          'Exit Gate 3', 'Exit Gate 4'),
               note='One-way: you cannot re-enter baggage claim once you exit.'),
    ],
)

VENUES = {'blr': BLR}
