"""Generic indoor walk graph + zone inference. No venue knowledge here."""
import math, heapq, collections

R = 6371000.0
TOL_M = 1.5        # MVT quantises coordinates per tile, so joins need a tolerance
ATTACH_M = 12.0    # lifts/stairs are often a single point; weld them into each level


def dist(a, b):
    (x1, y1), (x2, y2) = a, b
    dx = math.radians(x2 - x1) * math.cos(math.radians((y1 + y2) / 2)) * R
    dy = math.radians(y2 - y1) * R
    return math.hypot(dx, dy)


def bearing(a, b):
    (x1, y1), (x2, y2) = a, b
    return math.degrees(math.atan2(math.radians(x2 - x1) * math.cos(math.radians(y1)),
                                   math.radians(y2 - y1))) % 360


def turn_of(b0, b1):
    return (b1 - b0 + 540) % 360 - 180


def levels_of(tags):
    lv = tags.get('level')
    return [] if lv is None else [s for s in str(lv).split(';') if s]


WALK_KINDS = ('footway', 'steps', 'elevator')


class IndoorGraph:
    """Walkable network for ONE site (building). Cross-site edges never exist."""

    def __init__(self, features):
        self.f = features
        self.nodes = []                      # (lon, lat, level)
        self.adj = collections.defaultdict(dict)
        self._reg = {}
        self._build()

    # ---- construction ----
    def _node(self, pt, lv):
        deg = TOL_M / 111320.0
        cx, cy = int(pt[0] / deg), int(pt[1] / deg)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (lo, la, nid) in self._reg.get((cx + dx, cy + dy, lv), ()):
                    if dist(pt, (lo, la)) <= TOL_M: return nid
        nid = len(self.nodes)
        self.nodes.append((pt[0], pt[1], lv))
        self._reg.setdefault((cx, cy, lv), []).append((pt[0], pt[1], nid))
        return nid

    def _add(self, a, b, w, kind):
        if a == b: return
        if b not in self.adj[a] or w < self.adj[a][b][0]:
            self.adj[a][b] = (w, kind); self.adj[b][a] = (w, kind)

    def _build(self):
        walk = []
        for f in self.f:
            hw = f['tags'].get('highway')
            if hw not in WALK_KINDS: continue
            lvs, pts = levels_of(f['tags']), f['pts']
            if not lvs or not pts: continue
            walk.append((hw, lvs, pts))
            if len(pts) < 2: continue
            for lv in lvs:
                ns = [self._node(p, lv) for p in pts]
                for i in range(len(ns) - 1):
                    self._add(ns[i], ns[i + 1], dist(pts[i], pts[i + 1]), hw)

        self._index_levels()
        for hw, lvs, pts in walk:            # vertical connectors
            if len(lvs) < 2: continue
            p, ids = pts[0], []
            for lv in lvs:
                nid = self._node(p, lv); ids.append(nid)
                best, bd = None, 1e18
                for m in self.by_level.get(lv, ()):
                    if m == nid: continue
                    d = dist(p, (self.nodes[m][0], self.nodes[m][1]))
                    if d < bd: best, bd = m, d
                if best is not None and bd <= ATTACH_M:
                    self._add(nid, best, max(bd, 0.5), 'attach')
            for i in range(len(ids) - 1):
                self._add(ids[i], ids[i + 1], 25.0 if hw == 'elevator' else 20.0,
                          ('elevator' if hw == 'elevator' else 'steps') + ':transition')

        self._index_levels()
        self._index_components()

    def _index_levels(self):
        self.by_level = collections.defaultdict(list)
        for nid, (lo, la, lv) in enumerate(self.nodes):
            if nid in self.adj: self.by_level[lv].append(nid)

    def _index_components(self):
        self.comp = {}
        for n in self.adj:
            if n in self.comp: continue
            st = [n]
            while st:
                u = st.pop()
                if u in self.comp: continue
                self.comp[u] = n
                st.extend(m for m in self.adj[u] if m not in self.comp)

    def stitch(self, max_gap=6.0):
        """Join walk components separated by a small gap on the same level.

        Tile-derived networks fragment at doorways and tile seams: two corridors
        that visually meet end a couple of metres apart with no shared node.
        Repeatedly bridging the closest sub-threshold pair recovers real
        connectivity. Keep max_gap small — a large one will punch through walls.
        """
        joined = 0
        while True:
            groups = collections.defaultdict(list)
            for n in self.adj: groups[self.comp[n]].append(n)
            if len(groups) < 2: break
            # bucket by level and a coarse grid so this stays near-linear
            cell = max_gap / 111320.0
            grid = collections.defaultdict(list)
            for cid, ns in groups.items():
                for n in ns:
                    lo, la, lv = self.nodes[n]
                    grid[(int(lo / cell), int(la / cell), lv)].append((n, cid))
            best = None
            for (cx, cy, lv), items in grid.items():
                for dx in (0, 1):
                    for dy in (-1, 0, 1):
                        if dx == 0 and dy < 0: continue
                        other = grid.get((cx + dx, cy + dy, lv))
                        if not other: continue
                        for (a, ca) in items:
                            for (b, cb) in other:
                                if ca == cb: continue
                                d = dist(self.xy(a), self.xy(b))
                                if d <= max_gap and (best is None or d < best[0]):
                                    best = (d, a, b)
            if not best: break
            d, a, b = best
            self._add(a, b, max(d, 0.5), 'stitch')
            self._index_components()
            joined += 1
        self.stitched = joined
        return joined

    # ---- queries ----
    def xy(self, n): return (self.nodes[n][0], self.nodes[n][1])
    def level(self, n): return self.nodes[n][2]

    def snap(self, pt, lv):
        cands = self.by_level.get(lv) or []
        if not cands: return None, None
        b = min(cands, key=lambda n: dist(pt, self.xy(n)))
        return b, dist(pt, self.xy(b))

    def shortest(self, a, b, allowed=None):
        """Dijkstra. `allowed` is an optional predicate(node) gating traversal."""
        if a is None or b is None: return None
        pq = [(0.0, a)]; prev = {a: None}; done = {}
        while pq:
            d, n = heapq.heappop(pq)
            if n in done: continue
            done[n] = d
            if n == b: break
            for m, (w, kind) in self.adj[n].items():
                if m in done: continue
                if allowed is not None and m != b and not allowed(m): continue
                nd = d + w
                if m not in prev or nd < done.get(m, 1e18):
                    heapq.heappush(pq, (nd, m))
                    if m not in prev: prev[m] = (n, kind, w)
        if b not in done: return None
        out, cur = [], b
        while cur is not None:
            pr = prev.get(cur)
            out.append({'n': cur, 'kind': pr[1] if pr else None, 'w': pr[2] if pr else 0.0})
            cur = pr[0] if pr else None
        return {'path': list(reversed(out)), 'm': done[b]}


class Zoning:
    """Assigns every walk node to a zone.

    Real buildings separate airside from landside with control points, but the
    published map data does not encode that. So we seed from POIs that can only
    exist in one zone (a boarding gate is airside; a check-in desk is landside;
    a baggage belt is arrivals) and grow those labels through the walk graph,
    refusing to spread through a barrier POI. The barrier nodes themselves
    become portals — the only legal way to change zone.
    """

    def __init__(self, graph, pois, cfg, barrier_radius=14.0):
        self.g, self.cfg = graph, cfg
        self.zone = {}                       # node -> zone id
        self.portal_nodes = {}               # node -> POI acting as the portal
        self._barriers(pois, barrier_radius)
        self._seed_and_grow(pois)
        self._assign_pois(pois)

    def _matches(self, poi, tag, value):
        return str(poi['tags'].get(tag)) == value

    def _barriers(self, pois, radius):
        for p in pois:
            if not any(self._matches(p, b.tag, b.value) for b in self.cfg.barriers):
                continue
            n, d = self.g.snap(p['c'], p['level'])
            if n is None or d > 30: continue
            for m in self.g.by_level.get(p['level'], ()):
                if dist(self.g.xy(m), p['c']) <= radius:
                    self.portal_nodes[m] = p

    def _seed_and_grow(self, pois):
        seeds = []
        for p in pois:
            for s in self.cfg.seeds:
                if s.level and p['level'] != s.level: continue
                if self._matches(p, s.tag, s.value):
                    n, d = self.g.snap(p['c'], p['level'])
                    if n is not None and d <= 30 and n not in self.portal_nodes:
                        seeds.append((n, s.zone))
                    break
        pq = [(0.0, n, z) for n, z in seeds]
        heapq.heapify(pq)
        while pq:
            d, n, z = heapq.heappop(pq)
            if n in self.zone: continue
            self.zone[n] = z
            if n in self.portal_nodes: continue     # do not spread past a control point
            for m, (w, _) in self.g.adj[n].items():
                if m not in self.zone: heapq.heappush(pq, (d + w, m, z))
        # second pass: anything the barriers walled off, label by nearest zone
        # ignoring barriers, so it is at least usable (flagged as inferred).
        self.inferred = set()
        rest = [n for n in self.g.adj if n not in self.zone]
        if rest and self.zone:
            pq = [(0.0, n, z) for n, z in self.zone.items()]
            heapq.heapify(pq); seen = dict(self.zone)
            while pq:
                d, n, z = heapq.heappop(pq)
                for m, (w, _) in self.g.adj[n].items():
                    if m in seen: continue
                    seen[m] = z; self.inferred.add(m)
                    heapq.heappush(pq, (d + w, m, z))
            for n in rest:
                if n in seen: self.zone[n] = seen[n]

    def _assign_pois(self, pois):
        for p in pois:
            p['zone'] = self.zone.get(p.get('node')) if p.get('node') is not None else None
            p['is_portal'] = p.get('node') in self.portal_nodes

    def of(self, node): return self.zone.get(node)

    def portals_for(self, portal_cfg, pois):
        """POIs that can serve a given configured crossing."""
        out = []
        for p in pois:
            if portal_cfg.via_names and p['name'] in portal_cfg.via_names:
                out.append(p); continue
            if portal_cfg.via_tag and self._matches(p, *portal_cfg.via_tag):
                out.append(p)
        return out
