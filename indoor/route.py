"""Zone-aware routing + landmark narration.

Two rules distinguish this from a plain shortest-path:
  1. A route may not silently change zone. Crossing airside/landside or
     arrivals/departures is only possible through a configured Portal, and the
     crossing becomes a visible instruction.
  2. Illegal crossings are refused with a reason, never routed around.
"""
import math, collections
from .graph import dist, bearing, turn_of

TURN_DEG, SHARP_DEG, BEAR_DEG = 30, 105, 14
SIDE_M, RDP_M, LONG_M, MIN_SEG = 20, 4.0, 70, 7.0

# ---- which POIs make usable landmarks ----
BRAND = {'fast_food', 'cafe', 'restaurant', 'bar', 'duty_free', 'gift', 'clothes',
         'jewelry', 'cosmetics', 'bakery', 'pharmacy', 'convinience_store', 'shoes',
         'books', 'travel_agency', 'fashion_accessories', 'florist', 'electronics',
         'alcohol', 'confectionery', 'chocolate', 'toys', 'sports', 'perfumery'}
FUNC = {'toilets', 'atm', 'security', 'checkin', 'lounge', 'information', 'gate',
        'baggage_service', 'baggage_claim', 'baggage_secure_wrap', 'reception_desk',
        'bureau_de_change', 'smoking_area', 'prayer_room', 'nursery', 'first_aid'}
NOISE = {'bench', 'drinking_water', 'waste_basket', 'device_charging_station', 'art',
         'planter', 'seating', 'clock', 'artwork'}


def landmark_score(name, cat):
    if cat in NOISE: return 0
    n = (name or '').lower()
    if n.startswith('art by') or n.startswith('art display'): return 0
    if cat in BRAND:
        return 3 if n in {'restaurant', 'cafe', 'bar', 'duty free', 'shop', 'food court'} else 6
    if cat in FUNC: return 4
    return 2 if name else 0


# ---- geometry helpers ----
def _perp(p, a, b):
    if a == b: return dist(p, a)
    k = math.cos(math.radians(a[1]))
    m = lambda q: ((q[0] - a[0]) * k * 111320.0, (q[1] - a[1]) * 111320.0)
    px, py = m(p); bx, by = m(b)
    t = max(0.0, min(1.0, (px * bx + py * by) / ((bx * bx + by * by) or 1e-9)))
    return math.hypot(px - t * bx, py - t * by)


def rdp(pts, eps=RDP_M):
    if len(pts) < 3: return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = _perp(pts[i], pts[0], pts[-1])
        if d > dmax: dmax, idx = d, i
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def thin(pts, min_seg=MIN_SEG):
    if len(pts) < 3: return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        if dist(out[-1], p) >= min_seg: out.append(p)
    out.append(pts[-1])
    if len(out) > 2 and dist(out[-2], out[-1]) < min_seg: out.pop(-2)
    return out


def side_of(p0, p1, lm):
    return 'left' if turn_of(bearing(p0, p1), bearing(p0, lm)) < 0 else 'right'


class Navigator:
    def __init__(self, graph, pois, zoning, cfg, site_name=''):
        self.g, self.z, self.cfg, self.site_name = graph, zoning, cfg, site_name
        self.pois = pois
        for p in pois:
            n, d = graph.snap(p['c'], p['level'])
            p['node'], p['snap_m'] = n, d
            p['score'] = landmark_score(p['name'], p['cat'])
        zoning._assign_pois(pois)
        self.lm = collections.defaultdict(list)
        for p in pois:
            if p['score'] > 0 and p['node'] is not None: self.lm[p['level']].append(p)

    # ---- landmark lookup ----
    def near(self, pt, lv, radius, ex, zone=None):
        out = []
        for v in self.lm.get(lv, ()):
            if v['name'] in ex: continue
            if zone and v.get('zone') and v['zone'] != zone: continue
            d = dist(pt, v['c'])
            if d <= radius: out.append((d, v))
        out.sort(key=lambda t: (-t[1]['score'], t[0]))
        return out

    def corner(self, pt, lv, used, radius, recent, never, zone=None):
        for r in (radius, radius * 2, radius * 3):
            c = self.near(pt, lv, r, used, zone)
            if c: return c[0][1], ('far' if r > radius else False)
        ex = set(recent) | set(never)
        for r in (radius, radius * 2, radius * 3):
            c = self.near(pt, lv, r, ex, zone)
            if c: return c[0][1], ('far' if r > radius else True)
        return None, False

    def along(self, pts, lv, used, limit, never, zone=None):
        def scan(ex):
            hits = []
            for v in self.lm.get(lv, ()):
                if v['name'] in ex: continue
                if zone and v.get('zone') and v['zone'] != zone: continue
                bj, bd = 0, 1e18
                for j in range(len(pts) - 1):
                    d = _perp(v['c'], pts[j], pts[j + 1])
                    if d < bd: bd, bj = d, j
                if bd > SIDE_M: continue
                at = sum(dist(pts[k], pts[k + 1]) for k in range(bj))
                hits.append({'v': v, 'd': bd, 'at': at,
                             'side': side_of(pts[bj], pts[bj + 1], v['c'])})
            return hits
        hits = scan(used) or scan(never)
        hits.sort(key=lambda h: (-h['v']['score'], h['d']))
        return sorted(hits[:limit], key=lambda h: h['at'])

    # ---- zone policy ----
    def plan(self, origin, dest):
        """Decide the legal sequence of zones, or explain why there is none."""
        za, zb = origin.get('zone'), dest.get('zone')
        if za is None or zb is None or za == zb:
            return {'ok': True, 'legs': [(origin, dest, None)], 'zones': [za or zb]}
        p = self.cfg.portal_between(za, zb)
        if not p:
            back = self.cfg.portal_between(zb, za)
            za_n = (self.cfg.zone(za).name if self.cfg.zone(za) else za)
            zb_n = (self.cfg.zone(zb).name if self.cfg.zone(zb) else zb)
            why = (f'{za_n} and {zb_n} are separated by a control point that only '
                   f'works the other way.' if back else
                   f'{za_n} and {zb_n} are not connected for passengers.')
            return {'ok': False, 'reason': why, 'from_zone': za, 'to_zone': zb}
        cands = [c for c in self.z.portals_for(p, self.pois) if c.get('node') is not None]
        if not cands:
            return {'ok': False, 'reason': 'No usable control point is mapped for this crossing.',
                    'from_zone': za, 'to_zone': zb}
        best, bestd = None, 1e18
        for c in cands:
            r1 = self.g.shortest(origin['node'], c['node'])
            r2 = self.g.shortest(c['node'], dest['node'])
            if not r1 or not r2: continue
            if r1['m'] + r2['m'] < bestd: best, bestd = c, r1['m'] + r2['m']
        if not best:
            return {'ok': False, 'reason': 'No walkable path reaches the control point.',
                    'from_zone': za, 'to_zone': zb}
        return {'ok': True, 'legs': [(origin, best, p), (best, dest, None)], 'zones': [za, zb]}

    # ---- narration ----
    def directions(self, origin, dest):
        if origin['node'] is None or dest['node'] is None:
            return {'error': 'One of these places is not on the walkable map.'}
        plan = self.plan(origin, dest)
        if not plan['ok']:
            return {'error': plan['reason'], 'blocked': True,
                    'from_zone': plan.get('from_zone'), 'to_zone': plan.get('to_zone')}

        never = {origin['name'], dest['name']}
        for a, b, _ in plan['legs']: never |= {a['name'], b['name']}
        used, recent = set(never), set()
        steps, total, levels, lms = [], 0.0, [], []
        first = True

        for (a, b, portal) in plan['legs']:
            r = self.g.shortest(a['node'], b['node'])
            if not r: return {'error': f"No walkable path from {a['name']} to {b['name']}."}
            total += r['m']
            zone = a.get('zone')
            out = self._narrate(r['path'], a, b, used, recent, never, lms, zone,
                                opening=first, closing=(portal is None))
            steps += out
            levels += [self.g.level(s['n']) for s in r['path']]
            first = False
            if portal:
                steps.append({'t': 'portal',
                              'html': portal.verb.format(name=b['name']),
                              'note': portal.note})
        seq = []
        for l in levels:
            if not seq or seq[-1] != l: seq.append(l)
        return {'steps': steps, 'm': total, 'levels': seq, 'landmarks': lms,
                'zones': plan['zones'],
                'minutes': max(1, round(total / self.cfg.speed / 60))}

    def _segments(self, path):
        segs, cur = [], [path[0]['n']]
        for st in path[1:]:
            if st['kind'] and 'transition' in st['kind']:
                segs.append(('walk', cur))
                segs.append(('move', (cur[-1], st['n'], st['kind'])))
                cur = [st['n']]
            else: cur.append(st['n'])
        segs.append(('walk', cur))
        return [s for s in segs if s[0] == 'move' or len(s[1]) > 1]

    def _straights(self, nodes):
        pts = thin(rdp([self.g.xy(n) for n in nodes]))
        runs, start = [], 0
        for i in range(1, len(pts) - 1):
            if abs(turn_of(bearing(pts[i - 1], pts[i]), bearing(pts[i], pts[i + 1]))) >= TURN_DEG:
                runs.append(pts[start:i + 1]); start = i
        runs.append(pts[start:])
        out = []
        for r in runs:
            if len(r) < 2: continue
            out.append({'pts': r, 'm': sum(dist(r[j], r[j + 1]) for j in range(len(r) - 1))})
        return out

    def _narrate(self, path, origin, dest, used, recent, never, lms, zone,
                 opening, closing=True):
        B = lambda s: f'**{s}**'
        steps, segs = [], self._segments(path)

        if opening:
            fw = next((s for s in segs if s[0] == 'walk'), None)
            faced = None
            if fw:
                pts = rdp([self.g.xy(n) for n in fw[1]])
                lv = self.g.level(fw[1][0])
                head = bearing(pts[0], pts[1]); c = []
                for v in self.lm.get(lv, ()):
                    if v['name'] in used: continue
                    if zone and v.get('zone') and v['zone'] != zone: continue
                    d = dist(pts[0], v['c'])
                    if d > 60: continue
                    off = abs(turn_of(head, bearing(pts[0], v['c'])))
                    if off <= 70: c.append((off, d, v))
                c.sort(key=lambda t: (-t[2]['score'], t[0]))
                if c: faced = c[0][2]; used.add(faced['name']); lms.append(faced)
            steps.append({'t': 'start',
                          'html': (f"Stand at {B(origin['name'])} with it behind you, "
                                   f"facing {B(faced['name'])}." if faced
                                   else f"Start at {B(origin['name'])}.")})

        prev = None
        for kind, payload in segs:
            if kind == 'move':
                a, b, k = payload
                la, lb = self.g.level(a), self.g.level(b)
                anc, _ = self.corner(self.g.xy(a), la, used, 25, recent, never, zone)
                if anc: used.add(anc['name']); recent.clear(); recent.add(anc['name']); lms.append(anc)
                verb = 'down' if str(lb) < str(la) else 'up'
                mode = 'lift' if 'elevator' in k else 'escalator'
                beside = f" beside {B(anc['name'])}" if anc else ''
                steps.append({'t': 'level',
                              'html': f"Take the {mode}{beside} {verb} to **Level {lb}**."})
                prev = None; continue

            lv = self.g.level(payload[0])
            for run in self._straights(payload):
                pts = run['pts']; head = bearing(pts[0], pts[-1])
                if prev is not None:
                    t = turn_of(prev, head)
                    if abs(t) >= BEAR_DEG:
                        anc, reused = self.corner(pts[0], lv, used, 22, recent, never, zone)
                        if anc: used.add(anc['name']); recent.clear(); recent.add(anc['name']); lms.append(anc)
                        at = ('' if not anc else
                              f", towards {B(anc['name'])}" if reused == 'far' else
                              f" just after {B(anc['name'])}" if reused else
                              f" at {B(anc['name'])}")
                        word = ('Turn sharply' if abs(t) >= SHARP_DEG
                                else 'Turn' if abs(t) >= TURN_DEG else 'Bear')
                        steps.append({'t': 'turn', 'dir': 'right' if t > 0 else 'left',
                                      'html': f"{word} {'right' if t > 0 else 'left'}{at}."})
                got = self.along(pts, lv, used, 2 if run['m'] >= LONG_M else 1, never, zone)
                for h in got: used.add(h['v']['name']); lms.append(h['v'])
                d = f"{run['m']:.0f} m" if run['m'] >= 15 else None
                if len(got) == 2:
                    steps.append({'t': 'walk', 'd': d,
                                  'html': f"Walk past {B(got[0]['v']['name'])} on your {got[0]['side']}, "
                                          f"then {B(got[1]['v']['name'])} on your {got[1]['side']}."})
                elif got:
                    steps.append({'t': 'walk', 'd': d,
                                  'html': f"Walk past {B(got[0]['v']['name'])} on your {got[0]['side']}."})
                elif d:
                    steps.append({'t': 'walk', 'd': d, 'html': 'Keep going straight.'})
                prev = head

        if closing:
            nd = (self.near(dest['c'], dest['level'], 30, used | {dest['name']}, zone)
                  or self.near(dest['c'], dest['level'], 60, used | {dest['name']}, zone))
            steps.append({'t': 'end',
                          'html': (f"{B(dest['name'])} is right there, next to {B(nd[0][1]['name'])}."
                                   if nd else f"You have arrived at {B(dest['name'])}.")})
        return steps
