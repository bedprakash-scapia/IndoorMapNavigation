const D = __MALL_DATA__;
const M = D.m_per_px;
const FLOORS = D.floors.slice().sort((a, b) => a.order - b.order);
const FL = id => FLOORS.find(f => f.id === id) || { name: id };

/* ---------- graph ---------- */
const ADJ = D.nodes.map(() => []);
for (const [a, b, w, k] of D.edges) { ADJ[a].push([b, w, k]); ADJ[b].push([a, w, k]); }
const COMP = new Int32Array(D.nodes.length).fill(-1);
{ let c = 0;
  for (let s = 0; s < D.nodes.length; s++) {
    if (COMP[s] !== -1 || !ADJ[s].length) continue;
    const st = [s]; COMP[s] = c;
    while (st.length) { const u = st.pop(); for (const [v] of ADJ[u]) if (COMP[v] === -1) { COMP[v] = c; st.push(v); } }
    c++;
  } }
function shortest(a, b) {
  const N = D.nodes.length, dist = new Float64Array(N).fill(Infinity),
        prev = new Int32Array(N).fill(-1), kind = new Int8Array(N), done = new Uint8Array(N);
  dist[a] = 0; const pq = [[0, a]];
  while (pq.length) {
    pq.sort((x, y) => y[0] - x[0]);
    const [d, u] = pq.pop();
    if (done[u]) continue; done[u] = 1;
    if (u === b) break;
    for (const [v, w, k] of ADJ[u]) if (!done[v] && d + w < dist[v]) { dist[v] = d + w; prev[v] = u; kind[v] = k; pq.push([dist[v], v]); }
  }
  if (dist[b] === Infinity) return null;
  const path = []; let cur = b;
  while (cur !== -1) { path.push({ n: cur, k: kind[cur] }); cur = prev[cur]; }
  path.reverse(); if (path.length) path[0].k = 0;
  return { path, px: dist[b] };
}

/* ---------- geometry ---------- */
const P = i => [D.nodes[i][0], D.nodes[i][1]];
const LV = i => D.nodes[i][2];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const bearing = (a, b) => (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI + 360) % 360;
const turnOf = (x, y) => ((y - x + 540) % 360) - 180;
function perp(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*vx + (p[1]-a[1])*vy) / ((vx*vx+vy*vy)||1e-9)));
  return Math.hypot(p[0]-(a[0]+t*vx), p[1]-(a[1]+t*vy));
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perp(pts[i], pts[0], pts[pts.length-1]); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [pts[0], pts[pts.length-1]];
  return rdp(pts.slice(0, idx+1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
function thin(pts, min) {
  if (pts.length < 3) return pts;
  const o = [pts[0]];
  for (let i = 1; i < pts.length-1; i++) if (dist(o[o.length-1], pts[i]) >= min) o.push(pts[i]);
  o.push(pts[pts.length-1]);
  if (o.length > 2 && dist(o[o.length-2], o[o.length-1]) < min) o.splice(o.length-2, 1);
  return o;
}
const sideOf = (a, b, lm) => turnOf(bearing(a, b), bearing(a, lm)) < 0 ? 'left' : 'right';
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const B = s => '<b>' + esc(s) + '</b>';

/* the last few shops we named; a repeat inside this window reads as a bug */
const RECENT_N = 12;
function remember(recent, n) { recent.push(n); while (recent.length > RECENT_N) recent.shift(); }

const MIN_TURN = 24, MIN_BEAR = 13, SHARP = 100, SIDE_PX = 150, RDP_PX = 10, MIN_SEG_PX = 26;

/* landmarks are per floor: a shop one level up is no use as a steer */
const ON = {};
for (const u of D.units) (ON[u.l] ||= []).push(u);

function near(pt, lvl, radius, used) {
  const out = [];
  for (const u of (ON[lvl] || [])) { if (used.has(u.n)) continue;
    const d = dist(pt, u.c); if (d <= radius) out.push([d, u]); }
  out.sort((a, b) => (b[1].s - a[1].s) || (a[0] - b[0]));
  return out;
}
function anchor(pt, lvl, used, never, recent, radius = 170) {
  for (const r of [radius, radius*2, radius*3]) { const c = near(pt, lvl, r, used); if (c.length) return [c[0][1], r > radius]; }
  const ex = new Set([...never, ...recent]);
  for (const r of [radius, radius*2, radius*3]) { const c = near(pt, lvl, r, ex); if (c.length) return [c[0][1], true]; }
  return [null, false];
}
function along(pts, lvl, used, never, recent, limit) {
  const scan = ex => {
    const hits = [];
    for (const u of (ON[lvl] || [])) { if (ex.has(u.n)) continue;
      let bj = 0, bd = Infinity;
      for (let j = 0; j < pts.length-1; j++) { const d = perp(u.c, pts[j], pts[j+1]); if (d < bd) { bd = d; bj = j; } }
      if (bd > SIDE_PX) continue;
      let at = 0; for (let k = 0; k < bj; k++) at += dist(pts[k], pts[k+1]);
      hits.push({ u, d: bd, at, side: sideOf(pts[bj], pts[bj+1], u.c) });
    }
    return hits;
  };
  let h = scan(used);
  if (!h.length) h = scan(new Set([...never, ...recent]));
  if (!h.length) h = scan(never);
  h.sort((a, b) => (b.u.s - a.u.s) || (a.d - b.d));
  return h.slice(0, limit).sort((a, b) => a.at - b.at);
}

/* narrate one floor's worth of walking */
function narrate(raw, lvl, o, d, used, never, recent, lms, steps, opening, closing) {
  const pts = thin(rdp(raw, RDP_PX), MIN_SEG_PX);
  if (opening) {
    let faced = null;
    if (pts.length >= 2) {
      const head = bearing(pts[0], pts[1]); const c = [];
      for (const u of (ON[lvl] || [])) { if (used.has(u.n)) continue;
        const dd = dist(pts[0], u.c); if (dd > 420) continue;
        const off = Math.abs(turnOf(head, bearing(pts[0], u.c)));
        if (off <= 65) c.push([off, dd, u]); }
      c.sort((x, y) => (y[2].s - x[2].s) || (x[0] - y[0]));
      if (c.length) { faced = c[0][2]; used.add(faced.n); lms.push(faced); }
    }
    steps.push({ t: 'start', l: lvl, html: faced
      ? `Stand at ${B(o.n)} with it behind you, facing ${B(faced.n)}.`
      : `Start at ${B(o.n)}.` });
  }
  let prev = null;
  for (let i = 0; i < pts.length - 1; ) {
    let j = i + 1;
    while (j < pts.length - 1 && Math.abs(turnOf(bearing(pts[i], pts[j]), bearing(pts[j], pts[j+1]))) < MIN_TURN) j++;
    const run = pts.slice(i, j + 1);
    const head = bearing(run[0], run[run.length-1]);
    if (prev !== null) {
      const t = turnOf(prev, head);
      if (Math.abs(t) >= MIN_BEAR) {
        const [a, reused] = anchor(run[0], lvl, used, never, recent);
        if (a) { used.add(a.n); remember(recent, a.n); lms.push(a); }
        const at = !a ? '' : reused ? `, towards ${B(a.n)}` : ` at ${B(a.n)}`;
        const word = Math.abs(t) >= SHARP ? 'Turn sharply' : Math.abs(t) >= MIN_TURN ? 'Turn' : 'Bear';
        steps.push({ t: 'turn', l: lvl, dir: t > 0 ? 'right' : 'left',
                     html: `${word} ${t > 0 ? 'right' : 'left'}${at}.` });
      }
    }
    let len = 0; for (let k = 0; k < run.length-1; k++) len += dist(run[k], run[k+1]);
    const got = along(run, lvl, used, never, recent, len * M >= 45 ? 2 : 1);
    for (const g of got) { used.add(g.u.n); remember(recent, g.u.n); lms.push(g.u); }
    const dm = len * M >= 12 ? `${Math.round(len * M / 5) * 5} m` : null;
    if (got.length === 2)
      steps.push({ t: 'walk', l: lvl, d: dm, html: `Walk past ${B(got[0].u.n)} on your ${got[0].side}, then ${B(got[1].u.n)} on your ${got[1].side}.` });
    else if (got.length)
      steps.push({ t: 'walk', l: lvl, d: dm, html: `Walk past ${B(got[0].u.n)} on your ${got[0].side}.` });
    else if (dm) steps.push({ t: 'walk', l: lvl, d: dm, html: 'Keep going straight.' });
    prev = head; i = j;
  }
  if (closing) {
    const nd = near(d.c, lvl, 260, new Set([...used, d.n]));
    steps.push({ t: 'end', l: lvl, html: nd.length
      ? `${B(d.n)} is right there, next to ${B(nd[0][1].n)}.`
      : `You have arrived at ${B(d.n)}.` });
  }
}

function directions(o, d) {
  if (COMP[o.v] !== COMP[d.v]) return { err: 'No walking route between these two.' };
  const sp = shortest(o.v, d.v);
  if (!sp) return { err: 'No route found.' };

  // split where the path rides an escalator
  const legs = []; let cur = [sp.path[0].n];
  for (let i = 1; i < sp.path.length; i++) {
    const st = sp.path[i];
    if (st.k === 1) { legs.push({ nodes: cur, up: st.n }); cur = [st.n]; }
    else cur.push(st.n);
  }
  legs.push({ nodes: cur, up: null });

  const never = new Set([o.n, d.n]);
  const used = new Set(never);
  const recent = [];
  const steps = [], lms = [], levels = [];
  legs.forEach((leg, i) => {
    const lvl = LV(leg.nodes[0]);
    if (!levels.includes(lvl)) levels.push(lvl);
    if (leg.nodes.length >= 2)
      narrate(leg.nodes.map(P), lvl, o, d, used, never, recent, lms, steps, i === 0, leg.up === null);
    if (leg.up !== null) {
      const from = LV(leg.nodes[leg.nodes.length - 1]), to = LV(leg.up);
      const [a] = anchor(P(leg.nodes[leg.nodes.length - 1]), from, used, never, recent, 240);
      if (a) { used.add(a.n); remember(recent, a.n); lms.push(a); }
      const dir = FL(to).order > FL(from).order ? 'up' : 'down';
      steps.push({ t: 'esc', l: from, to,
                   html: `Take the escalator${a ? ` beside ${B(a.n)}` : ''} ${dir} to the `
                       + `${B(FL(to).name + ' floor')}.` });
    }
  });
  if (!steps.some(s => s.t === 'end'))
    steps.push({ t: 'end', l: LV(d.v), html: `You have arrived at ${B(d.n)}.` });

  return { steps, m: sp.px * M, path: sp.path, lms, levels,
           mins: Math.max(1, Math.round(sp.px * M / 1.25 / 60)) };
}

/* ---------- icons ---------- */
const IC = {
  start: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
  end: '<path d="M12 22s7-7.1 7-12A7 7 0 0 0 5 10c0 4.9 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>',
  walk: '<path d="M12 21V6M12 6l-5 5M12 6l5 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M17 21v-9a4 4 0 0 0-4-4H7M7 8l4-4M7 8l4 4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="M7 21v-9a4 4 0 0 1 4-4h6M17 8l-4-4M17 8l-4 4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  esc: '<path d="M4 18h4l8-9h4M4 18v3M20 9V6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.5" cy="5.5" r="2" fill="currentColor"/>'
};
const icon = s => s.t === 'start' ? IC.start : s.t === 'end' ? IC.end : s.t === 'esc' ? IC.esc
  : s.t === 'turn' ? (s.dir === 'left' ? IC.left : IC.right) : IC.walk;

/* ---------- UI ---------- */
let cur = { from: null, to: null }, last = null, shown = FLOORS[0].id;
/* A name alone is not a key: a concierge desk sits on every floor, Vero Moda has
   two stores, and the cinema spans levels. Look up by name AND floor. */
const byName = (n, l) => D.units.find(u => u.n === n && (l === undefined || u.l === l));
const PAL = D.palette;

function combo(id, key) {
  const inp = document.getElementById(id), menu = document.getElementById(id + '-menu');
  let items = [], sel = -1;
  const draw = q => {
    const s = q.trim().toLowerCase();
    const pool = [...D.units].sort((a, b) => a.n.localeCompare(b.n));
    items = (s ? pool.filter(u => u.n.toLowerCase().includes(s)) : pool).slice(0, 70);
    menu.innerHTML = items.length ? items.map((u, i) =>
      `<div class="opt${i === sel ? ' sel' : ''}" data-i="${i}">
        <span class="dot" style="background:${PAL[u.cat] || '#888'}"></span>
        <span class="nm">${esc(u.n)}</span>
        <span class="ct">${esc(FL(u.l).name)}</span></div>`).join('')
      : '<div class="opt"><span class="nm" style="color:var(--muted)">Nothing matches.</span></div>';
    menu.classList.add('on');
  };
  const pick = i => { if (!items[i]) return; cur[key] = items[i]; inp.value = items[i].n; menu.classList.remove('on'); render(); };
  inp.addEventListener('input', () => { sel = -1; draw(inp.value); });
  inp.addEventListener('focus', () => { sel = -1; draw(inp.value); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault();
      sel = Math.max(0, Math.min(items.length-1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(inp.value);
      menu.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pick(sel < 0 ? 0 : sel); }
    else if (e.key === 'Escape') menu.classList.remove('on');
  });
  menu.addEventListener('mousedown', e => { const o = e.target.closest('.opt'); if (o) { e.preventDefault(); pick(+o.dataset.i); } });
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== inp) menu.classList.remove('on'); });
  return inp;
}
const fromI = combo('from', 'from'), toI = combo('to', 'to');
document.getElementById('swap').addEventListener('click', () => {
  [cur.from, cur.to] = [cur.to, cur.from];
  fromI.value = cur.from ? cur.from.n : ''; toI.value = cur.to ? cur.to.n : ''; render();
});

for (const [a, af, b, bf] of [["Hamley's", 'G', 'Zara Women', '1'],
                              ['HomeCentre', 'G', 'PVR', '2'],
                              ['Zara Women', '1', 'Food Court', '2'],
                              ['Starbucks', '1', 'Costa Coffee', 'G']]) {
  const A = byName(a, af), Z = byName(b, bf); if (!A || !Z) continue;
  const btn = document.createElement('button');
  btn.className = 'chip'; btn.textContent = a + ' \u2192 ' + b;
  btn.addEventListener('click', () => { cur.from = A; cur.to = Z; fromI.value = a; toI.value = b; render(); });
  document.getElementById('chips').appendChild(btn);
}

const tabBox = document.getElementById('tabs');
function drawTabs() {
  tabBox.innerHTML = '';
  for (const f of FLOORS) {
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = f.name;
    b.setAttribute('aria-pressed', String(f.id === shown));
    b.addEventListener('click', () => { shown = f.id; drawTabs(); plan(); });
    tabBox.appendChild(b);
  }
}

function render() {
  const out = document.getElementById('out'), sum = document.getElementById('sum');
  if (!cur.from || !cur.to) { out.innerHTML = '<div class="empty">Pick two shops, or tap them on the plan.</div>'; sum.innerHTML = ''; last = null; plan(); return; }
  if (cur.from.n === cur.to.n) { out.innerHTML = '<div class="empty">You are already there.</div>'; sum.innerHTML = ''; last = null; plan(); return; }
  const r = directions(cur.from, cur.to); last = r;
  if (r.err) { sum.innerHTML = ''; out.innerHTML = `<div class="empty">${esc(r.err)}</div>`; plan(); return; }
  shown = cur.from.l; drawTabs();
  sum.innerHTML = `<div class="sum">
    <div><span class="k">Walk</span><span class="v">~${r.mins} min</span></div>
    <div><span class="k">Distance</span><span class="v">~${Math.round(r.m/5)*5} m</span></div>
    <div><span class="k">Floors</span><span class="v">${r.levels.map(l => FL(l).name).join(' \u2192 ')}</span></div>
    </div>`;
  out.innerHTML = '<ol>' + r.steps.map(s =>
    `<li class="t-${s.t}"><span class="ic"><svg viewBox="0 0 24 24">${icon(s)}</svg></span>
     <span class="tx">${s.html}</span>${s.d ? `<span class="dist">${s.d}</span>` : '<span></span>'}</li>`).join('') + '</ol>';
  plan();
}

function plan() {
  const svg = document.getElementById('plan');
  const f = FL(shown);
  if (f.size) svg.setAttribute('viewBox', `0 0 ${f.size[0]} ${f.size[1]}`);
  let s = '';
  for (const [a, b, , k] of D.edges) {
    if (k === 1 || LV(a) !== shown || LV(b) !== shown) continue;
    const A = P(a), Bb = P(b);
    s += `<line x1="${A[0]}" y1="${A[1]}" x2="${Bb[0]}" y2="${Bb[1]}" stroke="var(--map-walk)" stroke-width="9" stroke-linecap="round"/>`;
  }
  for (const u of D.units) {
    if (u.l !== shown || !u.poly || u.poly.length < 3) continue;
    const on = cur.from === u || cur.to === u;
    s += `<polygon class="unit" data-n="${esc(u.n)}" points="${u.poly.map(p => p.join(',')).join(' ')}" `
       + `fill="${PAL[u.cat] || '#888'}" stroke="${on ? 'var(--route)' : 'var(--map-line)'}" `
       + `stroke-width="${on ? 9 : 2.5}" opacity="${on ? 1 : .92}"><title>${esc(u.n)}</title></polygon>`;
  }
  if (last && last.path) {
    let run = [];
    const flush = () => { if (run.length > 1) s += `<polyline points="${run.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--route)" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>`; run = []; };
    for (const st of last.path) { if (LV(st.n) === shown) run.push(P(st.n)); else flush(); }
    flush();
    for (const u of last.lms) if (u.l === shown)
      s += `<circle cx="${u.c[0]}" cy="${u.c[1]}" r="7" fill="var(--route)" opacity=".85"/>`;
    // mark where the route changes floor
    for (let i = 1; i < last.path.length; i++) {
      if (last.path[i].k !== 1) continue;
      for (const n of [last.path[i-1].n, last.path[i].n]) if (LV(n) === shown) {
        const p = P(n);
        s += `<circle cx="${p[0]}" cy="${p[1]}" r="19" fill="none" stroke="var(--route)" stroke-width="7"/>`
           + `<circle cx="${p[0]}" cy="${p[1]}" r="7" fill="var(--route)"/>`;
      }
    }
  }
  for (const [u, fill] of [[cur.from, 'var(--pin)'], [cur.to, 'var(--route)']]) {
    if (!u || u.l !== shown) continue;
    s += `<circle cx="${u.c[0]}" cy="${u.c[1]}" r="16" fill="${fill}" stroke="var(--map-bg)" stroke-width="5"/>`;
  }
  svg.innerHTML = s;
  svg.querySelectorAll('.unit').forEach(el => el.addEventListener('click', () => {
    const u = byName(el.dataset.n); if (!u) return;
    if (!cur.from || (cur.from && cur.to)) { cur = { from: u, to: null }; fromI.value = u.n; toI.value = ''; }
    else { cur.to = u; toI.value = u.n; }
    render();
  }));
}

document.getElementById('legend').innerHTML = D.categories
  .filter(c => D.units.some(u => u.cat === c))
  .map(c => `<span><i class="dot" style="background:${PAL[c]}"></i>${esc(c)}</span>`).join('');

drawTabs();
const A0 = byName("Hamley's", 'G'), Z0 = byName('Zara Women', '1');
if (A0 && Z0) { cur.from = A0; cur.to = Z0; fromI.value = A0.n; toI.value = Z0.n; }
render();
