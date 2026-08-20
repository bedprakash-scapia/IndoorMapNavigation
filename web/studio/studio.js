/* Floor Plan Wayfinder - upload a directory sheet, name the shops, navigate. */

const BUILDING_WIDTH_M = 220;    // a drawing has no scale; this sets one
const ESC_COST_M = 22;
const CATEGORIES = ['Sportswear & Sportsgear','Department Stores','Foot Fashion, Bags & Luggage',
  'Watches, Jewellery & Accessories','Cosmetics, Salon, Spa & Optics','General Fashion',
  'Cafes, Restaurants & Desserts',"Women's Fashion","Men's Fashion",'Electronics & Gadgets',
  'Home, Gifts & Hobbies','Ethnic Fashion','Kids Fashion','Multiplex & Entertainment',
  'Food Court','Books, Music, Toys & Games','Hypermarket & Gourmet'];
const STRONG = new Set(['Cafes, Restaurants & Desserts','Department Stores','Food Court',
  'Multiplex & Entertainment','Sportswear & Sportsgear','Electronics & Gadgets',
  'Books, Music, Toys & Games','Hypermarket & Gourmet','Kids Fashion']);

const S = { floors: [], step: 1, shown: null, sel: null, from: null, to: null,
            last: null, escMode: false };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const B = s => '<b>' + esc(s) + '</b>';
const FL = id => S.floors.find(f => f.id === id);

/* ---------------- step 1: upload ---------------- */
function sideUpload() {
  $('side').innerHTML = `
    <h2>Upload a floor plan</h2>
    <p class="hint">A mall or airport directory sheet: shops in flat colours, walkways in a
      dark fill, a colour legend down one side. PNG or JPG.</p>
    <div class="drop" id="drop">Drop an image here, or click to choose<br>
      <span class="stat" id="dropn"></span></div>
    <input type="file" id="file" accept="image/*" multiple>
    <div class="prog hide" id="pw"><i id="pb"></i></div>
    <div class="stat" id="pmsg"></div>
    <div id="floorlist"></div>
    <div class="row"><button class="btn" id="next1" disabled>Name the shops</button></div>`;
  const drop = $('drop'), file = $('file');
  drop.onclick = () => file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); };
  file.onchange = () => take(file.files);
  $('next1').onclick = () => { S.step = 2; paint(); };
  listFloors();
}

function listFloors() {
  const el = $('floorlist'); if (!el) return;
  el.innerHTML = S.floors.map((f, i) => `
    <div class="nrow"><span class="sw" style="background:var(--route)"></span>
      <span class="nm">${esc(f.name)}</span>
      <span class="px">${f.units.length} shops &middot; ${f.nodes.length} pts</span></div>`).join('');
  const n = $('next1'); if (n) n.disabled = !S.floors.length;
  $('badge').textContent = S.floors.length
    ? S.floors.length + (S.floors.length === 1 ? ' floor' : ' floors') + ' loaded' : 'no plan loaded';
}

async function take(files) {
  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    $('pw').classList.remove('hide');
    const t0 = performance.now();
    const res = await extractSheet(img, m => { $('pmsg').textContent = m + '\u2026'; bump(); });
    $('pb').style.width = '100%';
    const id = 'F' + (S.floors.length + 1);
    S.floors.push({ id, name: floorName(S.floors.length), order: S.floors.length,
                    src: url, img, size: res.size, scale: res.scale,
                    nodes: res.nodes, edges: res.edges,
                    units: res.units.map((u, i) => ({ ...u, i, name: null,
                      cat: CATEGORIES[Math.min(u.cat, CATEGORIES.length-1)] || 'Other' })),
                    lab: res.lab, lw: res.lw, lh: res.lh, legend: res.legend, escs: [] });
    S.shown = id;
    $('pmsg').textContent = `${res.units.length} shops, ${res.nodes.length} walk points, `
      + `${Math.round((performance.now()-t0)/100)/10}s`;
    listFloors(); paint();
  }
}
let _p = 0;
function bump() { _p = Math.min(92, _p + 12); $('pb').style.width = _p + '%'; }
const floorName = i => ['Ground','First','Second','Third','Fourth','Fifth'][i] || ('Level ' + i);

/* ---------------- step 2: naming ---------------- */
function sideName() {
  const f = FL(S.shown); if (!f) { S.step = 1; return paint(); }
  const named = f.units.filter(u => u.name).length;
  $('side').innerHTML = `
    <h2>Name the shops on ${esc(f.name)}</h2>
    <p class="hint">Pick a shop &mdash; tap it on the plan, or tap any row in the list below &mdash;
      then type what it is. You never need the plan: the list alone is enough. Everything else
      &mdash; the walkways, the shapes, the categories &mdash; is already read from the image.</p>
    <div class="prog"><i style="width:${f.units.length ? 100*named/f.units.length : 0}%"></i></div>
    <div class="stat">${named} of ${f.units.length} named</div>
    ${S.api && S.api.naming ? `<button class="btn" id="auto" ${named === f.units.length ? 'disabled' : ''}
        style="margin-top:10px">Auto-name the remaining ${f.units.length - named}</button>
      <div class="stat" id="automsg"></div>` : ''}
    ${S.autoDone ? `<div class="flagnote">Read ${S.autoDone.named}.
       ${S.autoDone.flagged ? `<b>${S.autoDone.flagged} marked uncertain</b> - check those first;
         on the floors measured so far, six of seven uncertain reads were wrong.`
        : 'None marked uncertain.'}
       ${S.autoDone.failed ? `${S.autoDone.failed} could not be read.` : ''}</div>` : ''}
    <label for="nminput">Selected shop</label>
    <input type="text" id="nminput" placeholder="${S.sel == null ? 'Pick a shop first' : 'Type a name, press Enter'}"
      ${S.sel == null ? 'disabled' : ''} value="${esc(S.sel != null ? (f.units[S.sel].name || '') : '')}">
    <div class="row">
      <button class="btn ghost" id="skip">Skip</button>
      <button class="btn" id="save">Save name</button>
    </div>
    <div class="namelist" id="nl"></div>
    <div class="row">
      <button class="btn ghost" id="back2">Back</button>
      <button class="btn" id="next2" ${named < 2 ? 'disabled' : ''}>
        ${S.floors.length > 1 ? 'Link floors' : 'Navigate'}</button>
    </div>`;
  const nl = $('nl');
  nl.innerHTML = f.units.map(u => `
    <div class="nrow ${S.sel === u.i ? 'sel' : ''}" data-i="${u.i}">
      <span class="sw" style="background:rgb(${u.rgb.map(Math.round).join(',')})"></span>
      <span class="nm ${u.name ? '' : 'un'}">${esc(u.name || 'unnamed')}</span>
      ${u.unsure ? '<span class="warn" title="the model was unsure - worth checking">check</span>' : ''}
      <span class="px">${esc(u.cat.split(',')[0])}</span></div>`).join('');
  nl.onclick = e => { const r = e.target.closest('.nrow'); if (!r) return; select(+r.dataset.i); };
  nl.querySelector('.nrow.sel')?.scrollIntoView({ block: 'nearest' });
  const inp = $('nminput');
  if (S.sel != null) setTimeout(() => inp.focus(), 30);
  inp.onkeydown = e => { if (e.key === 'Enter') saveName(); };
  $('save').onclick = saveName;
  if ($('auto')) $('auto').onclick = autoName;
  $('skip').onclick = () => { const nx = f.units.find(u => u.name == null && u.i !== S.sel); select(nx ? nx.i : null); };
  $('back2').onclick = () => { S.step = 1; paint(); };
  $('next2').onclick = () => { S.step = S.floors.length > 1 ? 3 : 4; paint(); };
}
function select(i) { S.sel = i; paint(); }
function saveName() {
  const f = FL(S.shown), inp = $('nminput');
  if (S.sel == null || !inp) return;
  const v = inp.value.trim();
  f.units[S.sel].name = v || null;
  f.units[S.sel].unsure = false; f.units[S.sel].auto = false;
  const nx = f.units.find(u => u.name == null && u.i !== S.sel);
  S.sel = nx ? nx.i : null;
  paint();
}

/* ---------------- auto-naming ---------------- */
/* The crop must show the unit outlined. A crop always contains neighbouring
   shops, and without the outline there is no way to say which one is meant -
   that ambiguity produced wrong answers when these crops were first reviewed by
   eye. The outline is traced from the label map, so it is exact. */
function cropOf(f, u) {
  const k = 1 / f.scale;                        // working px -> sheet px
  const [x0, y0, x1, y1] = u.bbox;
  const pad = Math.max(14, (x1 - x0) / 6, (y1 - y0) / 6);
  const sx = Math.max(0, Math.floor((x0 - pad) * k)), sy = Math.max(0, Math.floor((y0 - pad) * k));
  const sw = Math.min(f.size[0] - sx, Math.ceil((x1 - x0 + 2 * pad) * k));
  const sh = Math.min(f.size[1] - sy, Math.ceil((y1 - y0 + 2 * pad) * k));
  const MAX = 420, s = Math.min(1, MAX / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  const g = c.getContext('2d');
  g.drawImage(f.img, sx, sy, sw, sh, 0, 0, c.width, c.height);

  // Marking the unit by outlining it swamps a narrow shop - a few pixels of line
  // either side and the label underneath is gone, which is why most crops came
  // back unreadable. Dim everything that is NOT the unit instead: the target is
  // then the only bright thing in the picture and nothing is ever covered up.
  const id = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let cy = 0; cy < c.height; cy++) {
    const wy = Math.round((cy / s + sy) * f.scale);
    for (let cx = 0; cx < c.width; cx++) {
      const wx = Math.round((cx / s + sx) * f.scale);
      const inside = wx >= 0 && wy >= 0 && wx < f.lw && wy < f.lh
                     && f.lab[wy * f.lw + wx] === u.labId;
      if (inside) continue;
      const i = (cy * c.width + cx) * 4;
      d[i] = d[i] * 0.30; d[i+1] = d[i+1] * 0.30; d[i+2] = d[i+2] * 0.34;
    }
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}

async function autoName() {
  const f = FL(S.shown);
  const todo = f.units.filter(u => !u.name);
  if (!todo.length) return;
  const btn = $('auto'); const set = m => { const e = $('automsg'); if (e) e.textContent = m; };
  if (btn) { btn.disabled = true; btn.textContent = 'Reading the labels...'; }
  const B = (S.api && S.api.batch_max) || 12;
  let done = 0, flagged = 0, failed = 0;
  for (let i = 0; i < todo.length; i += B) {
    const batch = todo.slice(i, i + B);
    try {
      const r = await fetch('/api/name', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: batch.map(u => ({ id: u.i, b64: cropOf(f, u) })) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      for (const u of batch) {
        const got = j.names[u.i] || j.names[String(u.i)];
        if (!got || !got.name) continue;
        u.name = got.name; u.auto = true; u.unsure = !got.confident;
        if (u.unsure) flagged++;
      }
    } catch (e) {
      failed += batch.length;
      set('Stopped: ' + String(e.message || e).slice(0, 90));
      break;
    }
    done += batch.length;
    set(`read ${Math.min(done, todo.length)} of ${todo.length}...`);
    paint();
    if (btn && $('auto')) { $('auto').disabled = true; $('auto').textContent = 'Reading the labels...'; }
  }
  S.autoDone = { named: f.units.filter(u => u.name).length, flagged, failed };
  paint();
}

/* ---------------- step 3: link floors ---------------- */
function sideLink() {
  const f = FL(S.shown);
  $('side').innerHTML = `
    <h2>Link the floors</h2>
    <p class="hint">Mark each escalator or lift, and give it the same name on every floor it
      reaches &mdash; that name is what joins the levels. Sheets are rarely aligned to each
      other, so matching by position is not safe.</p>
    <button class="btn ${S.escMode ? '' : 'ghost'}" id="escmode">
      ${S.escMode ? 'Tap the plan to place it' : 'Add an escalator on ' + esc(f.name)}</button>
    <div class="namelist" id="el"></div>
    <div class="row">
      <button class="btn ghost" id="back3">Back</button>
      <button class="btn" id="next3">Navigate</button>
    </div>`;
  const rows = [];
  for (const fl of S.floors) for (const e of fl.escs)
    rows.push(`<div class="nrow" data-f="${fl.id}" data-k="${e.key}">
      <span class="sw" style="background:var(--route)"></span>
      <span class="nm">${esc(e.name)}</span>
      <span class="px">${esc(fl.name)} &middot; remove</span></div>`);
  $('el').innerHTML = rows.join('') || '<div class="empty">No escalators yet.</div>';
  $('el').onclick = ev => {
    const r = ev.target.closest('.nrow'); if (!r) return;
    const fl = FL(r.dataset.f); fl.escs = fl.escs.filter(e => e.key !== +r.dataset.k); paint();
  };
  $('escmode').onclick = () => { S.escMode = !S.escMode; paint(); };
  $('back3').onclick = () => { S.step = 2; paint(); };
  $('next3').onclick = () => { S.step = 4; build(); paint(); };
}

/* ---------------- merged graph ---------------- */
let G = null;
function build() {
  const nodes = [], edges = [], units = [], base = {};
  let mpp = null;
  for (const f of S.floors) {
    base[f.id] = nodes.length;
    for (const n of f.nodes) nodes.push([n[0], n[1], f.id]);
    for (const [a, b, w] of f.edges) edges.push([a + base[f.id], b + base[f.id], w, 0]);
    if (mpp == null && f.units.length) {
      const xs = f.units.map(u => u.c[0]);
      mpp = BUILDING_WIDTH_M / Math.max(1, Math.max(...xs) - Math.min(...xs));
    }
    for (const u of f.units) if (u.name)
      units.push({ n: u.name, cat: u.cat, l: f.id, c: u.c, v: u.v + base[f.id],
                   s: STRONG.has(u.cat) ? 6 : 4 });
  }
  mpp = mpp || 0.12;
  const shafts = {};
  for (const f of S.floors) for (const e of f.escs)
    (shafts[e.name.toLowerCase()] ||= []).push({ f, node: e.node + base[f.id], order: f.order });
  const w = ESC_COST_M / mpp;
  for (const k in shafts) {
    const ends = shafts[k].sort((a, b) => a.order - b.order);
    for (let i = 0; i + 1 < ends.length; i++)
      edges.push([ends[i].node, ends[i+1].node, +w.toFixed(1), 1]);
  }
  const adj = nodes.map(() => []);
  for (const [a, b, ww, k] of edges) { adj[a].push([b, ww, k]); adj[b].push([a, ww, k]); }
  const comp = new Int32Array(nodes.length).fill(-1);
  let c = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || !adj[s].length) continue;
    const q = [s]; comp[s] = c;
    while (q.length) { const u = q.pop(); for (const [v] of adj[u]) if (comp[v] === -1) { comp[v] = c; q.push(v); } }
    c++;
  }
  G = { nodes, edges, units, adj, comp, mpp };
}

/* ---------------- routing + narration ---------------- */
const P = i => [G.nodes[i][0], G.nodes[i][1]];
const LV = i => G.nodes[i][2];
const dst = (a, b) => Math.hypot(b[0]-a[0], b[1]-a[1]);
const brg = (a, b) => (Math.atan2(b[0]-a[0], -(b[1]-a[1]))*180/Math.PI + 360) % 360;
const trn = (x, y) => ((y - x + 540) % 360) - 180;
function perp(p, a, b) {
  const vx = b[0]-a[0], vy = b[1]-a[1];
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*vx + (p[1]-a[1])*vy) / ((vx*vx+vy*vy)||1e-9)));
  return Math.hypot(p[0]-(a[0]+t*vx), p[1]-(a[1]+t*vy));
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let dm = 0, k = 0;
  for (let i = 1; i < pts.length-1; i++) { const d = perp(pts[i], pts[0], pts[pts.length-1]); if (d > dm) { dm = d; k = i; } }
  if (dm <= eps) return [pts[0], pts[pts.length-1]];
  return simplify(pts.slice(0, k+1), eps).slice(0, -1).concat(simplify(pts.slice(k), eps));
}
function thinPts(pts, min) {
  if (pts.length < 3) return pts;
  const o = [pts[0]];
  for (let i = 1; i < pts.length-1; i++) if (dst(o[o.length-1], pts[i]) >= min) o.push(pts[i]);
  o.push(pts[pts.length-1]);
  if (o.length > 2 && dst(o[o.length-2], o[o.length-1]) < min) o.splice(o.length-2, 1);
  return o;
}
function sp(a, b) {
  const N = G.nodes.length, d = new Float64Array(N).fill(Infinity),
        pv = new Int32Array(N).fill(-1), kd = new Int8Array(N), done = new Uint8Array(N);
  d[a] = 0; const pq = [[0, a]];
  while (pq.length) {
    pq.sort((x, y) => y[0]-x[0]);
    const [dd, u] = pq.pop();
    if (done[u]) continue; done[u] = 1;
    if (u === b) break;
    for (const [v, w, k] of G.adj[u]) if (!done[v] && dd + w < d[v]) { d[v] = dd+w; pv[v] = u; kd[v] = k; pq.push([d[v], v]); }
  }
  if (d[b] === Infinity) return null;
  const path = []; let cur = b;
  while (cur !== -1) { path.push({ n: cur, k: kd[cur] }); cur = pv[cur]; }
  path.reverse(); if (path.length) path[0].k = 0;
  return { path, px: d[b] };
}
const ON = () => { const m = {}; for (const u of G.units) (m[u.l] ||= []).push(u); return m; };
function near(pt, lvl, r, used, on) {
  const o = [];
  for (const u of (on[lvl] || [])) { if (used.has(u.n)) continue; const d = dst(pt, u.c); if (d <= r) o.push([d, u]); }
  o.sort((a, b) => (b[1].s - a[1].s) || (a[0] - b[0]));
  return o;
}
function anchorAt(pt, lvl, used, never, recent, on, r) {
  r = r || 170;
  for (const q of [r, r*2, r*3]) { const c = near(pt, lvl, q, used, on); if (c.length) return [c[0][1], q > r]; }
  const ex = new Set([...never, ...recent]);
  for (const q of [r, r*2, r*3]) { const c = near(pt, lvl, q, ex, on); if (c.length) return [c[0][1], true]; }
  return [null, false];
}
function flank(pts, lvl, used, never, recent, on, lim) {
  const scan = ex => {
    const h = [];
    for (const u of (on[lvl] || [])) { if (ex.has(u.n)) continue;
      let bj = 0, bd = Infinity;
      for (let j = 0; j < pts.length-1; j++) { const d = perp(u.c, pts[j], pts[j+1]); if (d < bd) { bd = d; bj = j; } }
      if (bd > 150) continue;
      let at = 0; for (let k = 0; k < bj; k++) at += dst(pts[k], pts[k+1]);
      h.push({ u, d: bd, at, side: trn(brg(pts[bj], pts[bj+1]), brg(pts[bj], u.c)) < 0 ? 'left' : 'right' });
    }
    return h;
  };
  let h = scan(used);
  if (!h.length) h = scan(new Set([...never, ...recent]));
  if (!h.length) h = scan(never);
  h.sort((a, b) => (b.u.s - a.u.s) || (a.d - b.d));
  return h.slice(0, lim).sort((a, b) => a.at - b.at);
}
function directions(o, d) {
  if (!G) return { err: 'Nothing built yet.' };
  if (G.comp[o.v] !== G.comp[d.v])
    return { err: 'No walking route between these two. If they are on different floors, link the floors first.' };
  const r = sp(o.v, d.v); if (!r) return { err: 'No route found.' };
  const legs = []; let cur = [r.path[0].n];
  for (let i = 1; i < r.path.length; i++) {
    const st = r.path[i];
    if (st.k === 1) { legs.push({ nodes: cur, up: st.n }); cur = [st.n]; } else cur.push(st.n);
  }
  legs.push({ nodes: cur, up: null });
  const on = ON(), M = G.mpp;
  const never = new Set([o.n, d.n]), used = new Set(never), recent = [];
  const remember = n => { recent.push(n); while (recent.length > 8) recent.shift(); };
  const steps = [], lms = [], levels = [];
  legs.forEach((leg, li) => {
    const lvl = LV(leg.nodes[0]);
    if (!levels.includes(lvl)) levels.push(lvl);
    if (leg.nodes.length >= 2) {
      const pts = thinPts(simplify(leg.nodes.map(P), 10), 26);
      if (li === 0) {
        let faced = null;
        if (pts.length >= 2) {
          const head = brg(pts[0], pts[1]), c = [];
          for (const u of (on[lvl] || [])) { if (used.has(u.n)) continue;
            const dd = dst(pts[0], u.c); if (dd > 420) continue;
            const off = Math.abs(trn(head, brg(pts[0], u.c)));
            if (off <= 65) c.push([off, dd, u]); }
          c.sort((x, y) => (y[2].s - x[2].s) || (x[0] - y[0]));
          if (c.length) { faced = c[0][2]; used.add(faced.n); remember(faced.n); lms.push(faced); }
        }
        steps.push({ t: 'start', html: faced
          ? `Stand at ${B(o.n)} with it behind you, facing ${B(faced.n)}.` : `Start at ${B(o.n)}.` });
      }
      let prev = null;
      for (let i = 0; i < pts.length - 1; ) {
        let j = i + 1;
        while (j < pts.length-1 && Math.abs(trn(brg(pts[i], pts[j]), brg(pts[j], pts[j+1]))) < 24) j++;
        const run = pts.slice(i, j+1), head = brg(run[0], run[run.length-1]);
        if (prev !== null) {
          const t = trn(prev, head);
          if (Math.abs(t) >= 13) {
            const [a, re] = anchorAt(run[0], lvl, used, never, recent, on);
            if (a) { used.add(a.n); remember(a.n); lms.push(a); }
            const at = !a ? '' : re ? `, towards ${B(a.n)}` : ` at ${B(a.n)}`;
            const word = Math.abs(t) >= 100 ? 'Turn sharply' : Math.abs(t) >= 24 ? 'Turn' : 'Bear';
            steps.push({ t: 'turn', dir: t > 0 ? 'right' : 'left', html: `${word} ${t > 0 ? 'right' : 'left'}${at}.` });
          }
        }
        let len = 0; for (let k = 0; k < run.length-1; k++) len += dst(run[k], run[k+1]);
        const got = flank(run, lvl, used, never, recent, on, len*M >= 45 ? 2 : 1);
        for (const g of got) { used.add(g.u.n); remember(g.u.n); lms.push(g.u); }
        const dm = len*M >= 12 ? `${Math.round(len*M/5)*5} m` : null;
        if (got.length === 2)
          steps.push({ t: 'walk', d: dm, html: `Walk past ${B(got[0].u.n)} on your ${got[0].side}, then ${B(got[1].u.n)} on your ${got[1].side}.` });
        else if (got.length)
          steps.push({ t: 'walk', d: dm, html: `Walk past ${B(got[0].u.n)} on your ${got[0].side}.` });
        else if (dm) steps.push({ t: 'walk', d: dm, html: 'Keep going straight.' });
        prev = head; i = j;
      }
      if (leg.up === null) {
        const nd = near(d.c, lvl, 260, new Set([...used, d.n]), on);
        steps.push({ t: 'end', html: nd.length
          ? `${B(d.n)} is right there, next to ${B(nd[0][1].n)}.` : `You have arrived at ${B(d.n)}.` });
      }
    }
    if (leg.up !== null) {
      const from = LV(leg.nodes[leg.nodes.length-1]), to = LV(leg.up);
      const [a] = anchorAt(P(leg.nodes[leg.nodes.length-1]), from, used, never, recent, on, 240);
      if (a) { used.add(a.n); remember(a.n); lms.push(a); }
      const dir = FL(to).order > FL(from).order ? 'up' : 'down';
      steps.push({ t: 'esc', html: `Take the escalator${a ? ` beside ${B(a.n)}` : ''} ${dir} to ${B(FL(to).name)}.` });
    }
  });
  if (!steps.some(s => s.t === 'end')) steps.push({ t: 'end', html: `You have arrived at ${B(d.n)}.` });
  return { steps, m: r.px * G.mpp, path: r.path, lms, levels,
           mins: Math.max(1, Math.round(r.px * G.mpp / 1.25 / 60)) };
}

/* ---------------- step 4: navigate ---------------- */
const IC = {
  start:'<circle cx="12" cy="12" r="4.5" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
  end:'<path d="M12 22s7-7.1 7-12A7 7 0 0 0 5 10c0 4.9 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>',
  walk:'<path d="M12 21V6M12 6l-5 5M12 6l5 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  left:'<path d="M17 21v-9a4 4 0 0 0-4-4H7M7 8l4-4M7 8l4 4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  right:'<path d="M7 21v-9a4 4 0 0 1 4-4h6M17 8l-4-4M17 8l-4 4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  esc:'<path d="M4 18h4l8-9h4M4 18v3M20 9V6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.5" cy="5.5" r="2" fill="currentColor"/>'
};
const iconOf = s => s.t === 'start' ? IC.start : s.t === 'end' ? IC.end : s.t === 'esc' ? IC.esc
  : s.t === 'turn' ? (s.dir === 'left' ? IC.left : IC.right) : IC.walk;

function sideNav() {
  if (!G) build();
  const named = G.units.length;
  $('side').innerHTML = `
    <h2>Navigate</h2>
    <p class="hint">${named} named shop${named === 1 ? '' : 's'} across
      ${S.floors.length} floor${S.floors.length === 1 ? '' : 's'}. Tap the plan to pick, too.</p>
    <label for="from">Where you are</label>
    <div class="field"><input type="text" id="from" autocomplete="off" placeholder="Search"><div class="menu" id="from-menu"></div></div>
    <label for="to">Where you want to go</label>
    <div class="field"><input type="text" id="to" autocomplete="off" placeholder="Search"><div class="menu" id="to-menu"></div></div>
    <div class="row">
      <button class="btn ghost" id="back4">Back</button>
      <button class="btn ghost" id="exp">Export venue</button>
    </div>
    <div id="sum"></div>
    <div id="out"><div class="empty">Pick two shops.</div></div>`;
  combo('from'); combo('to');
  $('back4').onclick = () => { S.step = S.floors.length > 1 ? 3 : 2; paint(); };
  $('exp').onclick = exportVenue;
  if (S.from) $('from').value = S.from.n;
  if (S.to) $('to').value = S.to.n;
  renderRoute();
}
function combo(id) {
  const inp = $(id), menu = $(id + '-menu');
  let items = [], sel = -1;
  const draw = q => {
    const s = q.trim().toLowerCase();
    const pool = [...G.units].sort((a, b) => a.n.localeCompare(b.n));
    items = (s ? pool.filter(u => u.n.toLowerCase().includes(s)) : pool).slice(0, 60);
    menu.innerHTML = items.length ? items.map((u, i) =>
      `<div class="opt${i === sel ? ' sel' : ''}" data-i="${i}">${esc(u.n)}<span class="fl">${esc(FL(u.l).name)}</span></div>`).join('')
      : '<div class="opt" style="color:var(--muted)">Nothing matches.</div>';
    menu.classList.add('on');
  };
  const pick = i => { if (!items[i]) return; S[id] = items[i]; inp.value = items[i].n; menu.classList.remove('on'); S.shown = items[i].l; renderRoute(); drawTabs(); drawPlan(); };
  inp.oninput = () => { sel = -1; draw(inp.value); };
  inp.onfocus = () => { sel = -1; draw(inp.value); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault();
      sel = Math.max(0, Math.min(items.length-1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(inp.value); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel < 0 ? 0 : sel); }
    else if (e.key === 'Escape') menu.classList.remove('on');
  };
  menu.onmousedown = e => { const o = e.target.closest('.opt'); if (o && o.dataset.i !== undefined) { e.preventDefault(); pick(+o.dataset.i); } };
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== inp) menu.classList.remove('on'); });
}
function renderRoute() {
  const out = $('out'), sum = $('sum'); if (!out) return;
  if (!S.from || !S.to) { out.innerHTML = '<div class="empty">Pick two shops.</div>'; sum.innerHTML = ''; S.last = null; return drawPlan(); }
  if (S.from.n === S.to.n) { out.innerHTML = '<div class="empty">You are already there.</div>'; sum.innerHTML = ''; S.last = null; return drawPlan(); }
  const r = directions(S.from, S.to); S.last = r;
  if (r.err) { sum.innerHTML = ''; out.innerHTML = `<div class="empty">${esc(r.err)}</div>`; return drawPlan(); }
  sum.innerHTML = `<div class="sum">
    <div><span class="k">Walk</span><span class="v">~${r.mins} min</span></div>
    <div><span class="k">Distance</span><span class="v">~${Math.round(r.m/5)*5} m</span></div>
    <div><span class="k">Floors</span><span class="v">${r.levels.map(l => FL(l).name).join(' \u2192 ')}</span></div></div>`;
  out.innerHTML = '<ol>' + r.steps.map(s =>
    `<li class="t-${s.t}"><span class="ic"><svg viewBox="0 0 24 24">${iconOf(s)}</svg></span>
     <span class="tx">${s.html}</span>${s.d ? `<span class="dist">${s.d}</span>` : '<span></span>'}</li>`).join('') + '</ol>';
  drawPlan();
}

/* ---------------- export ---------------- */
async function exportVenue() {
  const dl = await (window.claude && claude.use ? claude.use('downloads') : null);
  const data = {
    generator: 'Floor Plan Wayfinder', m_per_px: G ? G.mpp : null,
    categories: CATEGORIES,
    floors: S.floors.map(f => ({ id: f.id, name: f.name, order: f.order, size: f.size,
      nodes: f.nodes, edges: f.edges,
      escalators: f.escs.map(e => ({ name: e.name, node: e.node })),
      units: f.units.filter(u => u.name).map(u => ({ name: u.name, cat: u.cat, c: u.c, v: u.v })) }))
  };
  const json = JSON.stringify(data);
  if (!dl) { alert('Download is not available in this view. The venue JSON was logged to the console instead.'); console.log(json); return; }
  try { await dl.save({ filename: 'venue.json', data: json }); }
  catch (e) { console.log('export declined or failed', e); }
}

/* ---------------- map ---------------- */
function drawTabs() {
  const t = $('tabs');
  t.innerHTML = S.floors.map(f =>
    `<button class="tab" data-f="${f.id}" aria-pressed="${f.id === S.shown}">${esc(f.name)}</button>`).join('');
  t.onclick = e => { const b = e.target.closest('.tab'); if (!b) return; S.shown = b.dataset.f; S.sel = null; paint(); };
}
function drawPlan() {
  const svg = $('plan'), f = FL(S.shown);
  if (!f) { svg.innerHTML = ''; $('maphint').textContent = ''; return; }
  svg.setAttribute('viewBox', `0 0 ${f.size[0]} ${f.size[1]}`);
  let s = `<image href="${f.src}" x="0" y="0" width="${f.size[0]}" height="${f.size[1]}"/>`;
  if (S.step <= 3) {
    for (const [a, b] of f.edges)
      s += `<line x1="${f.nodes[a][0]}" y1="${f.nodes[a][1]}" x2="${f.nodes[b][0]}" y2="${f.nodes[b][1]}"
             stroke="var(--walk)" stroke-width="5" stroke-opacity=".75" stroke-linecap="round"/>`;
    for (const u of f.units) {
      const on = u.i === S.sel;
      s += `<circle class="shop" data-i="${u.i}" cx="${u.c[0]}" cy="${u.c[1]}" r="${on ? 22 : 13}"
             fill="${u.name ? 'var(--ok)' : 'var(--route)'}" fill-opacity="${on ? 1 : .85}"
             stroke="#fff" stroke-width="${on ? 6 : 3}"><title>${esc(u.name || 'unnamed')}</title></circle>`;
    }
  }
  for (const e of f.escs)
    s += `<g><circle cx="${f.nodes[e.node][0]}" cy="${f.nodes[e.node][1]}" r="26" fill="none" stroke="var(--route)" stroke-width="8"/>
          <circle cx="${f.nodes[e.node][0]}" cy="${f.nodes[e.node][1]}" r="9" fill="var(--route)"/></g>`;
  if (S.step === 4 && S.last && S.last.path) {
    let run = [];
    const flush = () => { if (run.length > 1) s += `<polyline points="${run.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--route)" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>`; run = []; };
    for (const st of S.last.path) { if (LV(st.n) === S.shown) run.push(P(st.n)); else flush(); }
    flush();
    for (const u of S.last.lms) if (u.l === S.shown)
      s += `<circle cx="${u.c[0]}" cy="${u.c[1]}" r="8" fill="var(--route)" opacity=".9"/>`;
    for (const [u, fill] of [[S.from, 'var(--pin)'], [S.to, 'var(--route)']])
      if (u && u.l === S.shown) s += `<circle cx="${u.c[0]}" cy="${u.c[1]}" r="18" fill="${fill}" stroke="#fff" stroke-width="5"/>`;
  }
  svg.innerHTML = s;
  svg.onclick = ev => {
    const pt = svgPoint(svg, ev);
    if (S.escMode && S.step === 3) return placeEsc(f, pt);
    if (S.step === 2) {
      const c = ev.target.closest('.shop');
      if (c) return select(+c.dataset.i);
      const u = hit(f, pt); if (u) select(u.i);
    }
    if (S.step === 4) {
      const u0 = hit(f, pt); if (!u0 || !u0.name) return;
      const gu = G.units.find(x => x.n === u0.name && x.l === f.id); if (!gu) return;
      if (!S.from || (S.from && S.to)) { S.from = gu; S.to = null; } else S.to = gu;
      sideNav();
    }
  };
  $('maphint').innerHTML = S.step === 2
    ? 'Green dots are named, pink are not. Tap one to name it.'
    : S.step === 3 ? (S.escMode ? '<b>Tap the escalator on the plan.</b>' : 'Escalators are ringed.')
    : S.step === 4 ? 'Tap a shop to set start, then destination.' : '';
}
function svgPoint(svg, ev) {
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  return [(ev.clientX - r.left) / r.width * vb.width, (ev.clientY - r.top) / r.height * vb.height];
}
function hit(f, pt) {
  const x = Math.round(pt[0] * f.scale), y = Math.round(pt[1] * f.scale);
  if (x < 0 || y < 0 || x >= f.lw || y >= f.lh) return null;
  const id = f.lab[y * f.lw + x];
  if (id < 0) {                       // not on a shop: fall back to the nearest marker
    let best = null, bd = 1e9;
    for (const u of f.units) { const d = Math.hypot(u.c[0]-pt[0], u.c[1]-pt[1]); if (d < bd) { bd = d; best = u; } }
    return bd < 60 ? best : null;
  }
  return f.units.find(u => u.labId === id) || null;
}
function placeEsc(f, pt) {
  let bi = 0, bd = Infinity;
  f.nodes.forEach((n, i) => { const d = Math.hypot(n[0]-pt[0], n[1]-pt[1]); if (d < bd) { bd = d; bi = i; } });
  const name = prompt('Name this escalator. Use the SAME name on every floor it reaches '
                    + '(for example "Atrium 2") - that name is what joins the levels.');
  if (!name) return;
  f.escs.push({ key: Date.now(), name: name.trim(), node: bi });
  S.escMode = false; paint();
}

/* ---------------- shell ---------------- */
/* Ask the server whether it can name at all. Served as a bare file, or from the
   published artifact where the CSP blocks outbound calls, this simply fails and
   the button never appears - naming stays manual, which is the honest fallback. */
async function probe() {
  try {
    const r = await fetch('/api/status');
    if (r.ok) S.api = await r.json();
  } catch (e) { S.api = null; }
  paint();
}
function paint() {
  for (const b of document.querySelectorAll('#rail b')) {
    const n = +b.dataset.step;
    b.dataset.on = n === S.step ? '1' : '0';
    b.dataset.done = n < S.step ? '1' : '0';
  }
  if (S.step === 1) sideUpload();
  else if (S.step === 2) sideName();
  else if (S.step === 3) sideLink();
  else sideNav();
  drawTabs(); drawPlan();
}
paint();
probe();
