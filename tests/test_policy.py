"""Zone-policy regression tests.

These are the safety-critical cases: a route must never silently cross between
airside, landside and arrivals. If you change zoning, seeds, barriers or
portals, these tests are what tell you whether you broke a passenger journey.

They run against the cached fetch in data/raw_features.json and need no network
and no API key. If the cache is missing they skip with instructions.
"""
import os, sys, json
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from indoor.source import split_sites, pois_of
from indoor.graph import IndoorGraph, Zoning
from indoor.route import Navigator
from indoor.venue import VENUES

CACHE = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw_features.json')
STITCH_M = 8.0
pytestmark = pytest.mark.skipif(
    not os.path.exists(CACHE),
    reason='data/raw_features.json missing — run: WOOSMAP_KEY=... python3 scripts/build.py --refresh')


@pytest.fixture(scope='module')
def sites():
    cfg = VENUES['blr']
    feats = json.load(open(CACHE))
    out = {}
    for sid, fl in split_sites(feats, cfg).items():
        g = IndoorGraph(fl)
        g.stitch(STITCH_M)
        pois = pois_of(fl)
        for p in pois:
            p['node'], p['snap_m'] = g.snap(p['c'], p['level'])
        z = Zoning(g, pois, cfg)
        out[sid] = {'nav': Navigator(g, pois, z, cfg, site_name=sid),
                    'pois': pois, 'graph': g}
    return out


def find(site, name):
    return next((p for p in site['pois'] if p['name'] == name), None)


def route(site, a, b):
    A, Z = find(site, a), find(site, b)
    assert A is not None, f'POI missing: {a}'
    assert Z is not None, f'POI missing: {b}'
    return site['nav'].directions(A, Z), A, Z


# --------------------------------------------------------------- terminals
def test_terminals_are_separate(sites):
    assert set(sites) == {'T1', 'T2'}


def test_no_feature_leaks_across_terminals(sites):
    """Venue bboxes overlap, so this must be decided by building:ref."""
    for sid, s in sites.items():
        for p in s['pois']:
            ref = p['tags'].get('building:ref')
            assert ref in (('bial_t1', 'T1') if sid == 'T1' else ('bial_t2', 'T2')), \
                f'{p["name"]} has building:ref={ref} but landed in {sid}'


# ------------------------------------------------------------ zone policy
def test_arrivals_cannot_reach_departure_gates(sites):
    r, A, Z = route(sites['T2'], 'Belt 1', 'Gate C1')
    assert A['zone'] == 'arrivals' and Z['zone'] == 'airside-dep'
    assert r.get('blocked'), 'baggage claim must not route to a departure gate'


def test_airside_cannot_go_back_landside(sites):
    r, A, Z = route(sites['T2'], 'Gate C1', 'CheckIn A1 to A15')
    assert A['zone'] == 'airside-dep' and Z['zone'] == 'landside-dep'
    assert r.get('blocked'), 'security is one-way; this must be refused'


def test_checkin_to_gate_is_allowed_through_security(sites):
    r, A, Z = route(sites['T2'], 'CheckIn A1 to A15', 'Gate C1')
    assert A['zone'] == 'landside-dep' and Z['zone'] == 'airside-dep'
    assert 'error' not in r, r.get('error')
    portals = [s for s in r['steps'] if s['t'] == 'portal']
    assert len(portals) == 1, 'the security crossing must be exactly one visible step'
    assert 'Clear' in portals[0]['html']
    assert r['zones'] == ['landside-dep', 'airside-dep']


def test_same_zone_route_has_no_portal(sites):
    r, _, _ = route(sites['T2'], 'Belt 1', 'Belt 4')
    assert 'error' not in r
    assert not [s for s in r['steps'] if s['t'] == 'portal']


# -------------------------------------------------------------- narration
def test_route_is_landmark_anchored(sites):
    """Directions must name places, not just distances."""
    r, _, _ = route(sites['T2'], 'Domestic Security', 'KFC')
    assert 'error' not in r
    assert r['steps'][0]['t'] == 'start'
    assert r['steps'][-1]['t'] == 'end'
    named = [s for s in r['steps'] if '**' in s['html']]
    assert len(named) >= len(r['steps']) // 2, 'most steps should reference a landmark'


def test_endpoints_are_never_their_own_landmark(sites):
    r, A, Z = route(sites['T2'], 'Domestic Security', 'KFC')
    for s in r['steps'][1:-1]:
        assert Z['name'] not in s['html'], 'destination used as a mid-route landmark'


def test_arrival_is_only_announced_once(sites):
    """A portal leg must not emit 'you have arrived' at the control point."""
    r, _, _ = route(sites['T2'], 'CheckIn A1 to A15', 'Gate C1')
    assert len([s for s in r['steps'] if s['t'] == 'end']) == 1


# ------------------------------------------------------------ walk network
def test_stitching_keeps_the_network_usable(sites):
    """Without stitching, check-in cannot reach any security POI at all."""
    import collections
    g = sites['T2']['graph']
    sizes = collections.Counter(g.comp.values())
    biggest = sizes.most_common(1)[0][1]
    assert biggest / len(g.adj) > 0.85, 'walk network is too fragmented to route on'


def test_building_polygons_are_not_pois(sites):
    for s in sites.values():
        for p in s['pois']:
            assert p['tags'].get('indoor') != 'level'
            assert not p['tags'].get('building:name')
