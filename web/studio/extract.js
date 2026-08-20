/* Floor-plan image -> walk graph + shop polygons, entirely in the browser.
   A port of imagemaps/extract.py; the same five traps are handled here. */

const DARK = 0x70;          // at or below this is a boundary line or background
const WHITE = 0xE0;
const MIN_UNIT_FULL = 400;  // px at the sheet's own resolution
const MIN_FILL = 0.20;      // a real unit fills its bbox; the building outline does not
const WORK_W = 1400;        // downscale for speed; coordinates are scaled back after

/* ---------- image -> working buffers ---------- */
function toWorking(img) {
  const scale = Math.min(1, WORK_W / img.width);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, scale,
           full: [img.width, img.height] };
}

const maxc = (d, i) => Math.max(d[i], d[i+1], d[i+2]);
const minc = (d, i) => Math.min(d[i], d[i+1], d[i+2]);

/* ---------- walkable concourse ---------- */
function walkable(im) {
  const { data, w, h } = im, N = w * h;
  const dark = new Uint8Array(N);
  for (let p = 0; p < N; p++) dark[p] = maxc(data, p * 4) <= DARK ? 1 : 0;

  // Flood from the border: dark reachable from outside is not the concourse.
  const out = new Uint8Array(N), q = [];
  const push = p => { if (dark[p] && !out[p]) { out[p] = 1; q.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h-1)*w + x); }
  for (let y = 0; y < h; y++) { push(y*w); push(y*w + w-1); }
  for (let i = 0; i < q.length; i++) {
    const p = q[i], x = p % w, y = (p - x) / w;
    if (x > 0) push(p-1); if (x < w-1) push(p+1);
    if (y > 0) push(p-w); if (y < h-1) push(p+w);
  }
  const inside = new Uint8Array(N);
  for (let p = 0; p < N; p++) inside[p] = dark[p] && !out[p] ? 1 : 0;
  return keepLargest(inside, w, h);
}

function keepLargest(mask, w, h) {
  const N = w*h, lab = new Int32Array(N).fill(-1);
  let best = -1, bestN = 0, id = 0;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || lab[s] !== -1) continue;
    const q = [s]; lab[s] = id; let n = 0;
    for (let i = 0; i < q.length; i++) {
      const p = q[i]; n++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny*w + nx;
        if (mask[np] && lab[np] === -1) { lab[np] = id; q.push(np); }
      }
    }
    if (n > bestN) { bestN = n; best = id; }
    id++;
  }
  const outm = new Uint8Array(N);
  for (let p = 0; p < N; p++) outm[p] = lab[p] === best ? 1 : 0;
  return outm;
}

function close(mask, w, h, r) {          // dilate then erode: seals hairline gaps
  const N = w*h;
  const grow = (src, want) => {
    const dst = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (src[ny*w+nx] === want) { hit = 1; break; }
      }
      dst[y*w+x] = want ? hit : (hit ? 0 : 1);
    }
    return dst;
  };
  return grow(grow(mask, 1), 0);
}

/* ---------- skeleton (Zhang-Suen) ---------- */
function skeletonize(mask, w, h) {
  const m = Uint8Array.from(mask);
  const at = (x, y) => m[y*w + x];
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del = [];
      for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
        if (!at(x, y)) continue;
        const p2=at(x,y-1),p3=at(x+1,y-1),p4=at(x+1,y),p5=at(x+1,y+1),
              p6=at(x,y+1),p7=at(x-1,y+1),p8=at(x-1,y),p9=at(x-1,y-1);
        const B = p2+p3+p4+p5+p6+p7+p8+p9;
        if (B < 2 || B > 6) continue;
        const s = [p2,p3,p4,p5,p6,p7,p8,p9,p2];
        let A = 0; for (let i = 0; i < 8; i++) if (!s[i] && s[i+1]) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2*p4*p6 || p4*p6*p8) continue; }
        else            { if (p2*p4*p8 || p2*p6*p8) continue; }
        del.push(y*w + x);
      }
      if (del.length) { changed = true; for (const i of del) m[i] = 0; }
    }
  }
  return m;
}

/* ---------- skeleton -> node/edge graph ---------- */
function graphOf(skel, w, h, scale) {
  const nb = (x, y) => {
    const o = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x+dx, ny = y+dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (skel[ny*w+nx]) o.push([nx, ny]);
    }
    return o;
  };
  const isNode = (x, y) => nb(x, y).length !== 2;
  const idx = new Map(), nodes = [], edges = [];
  const key = (x, y) => y*w + x;
  const nid = (x, y) => {
    const k = key(x, y);
    if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push([Math.round(x/scale), Math.round(y/scale)]); }
    return idx.get(k);
  };
  const seen = new Set();
  const ends = [];
  for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++)
    if (skel[key(x, y)] && isNode(x, y)) ends.push([x, y]);
  if (!ends.length) {
    for (let y = 1; y < h-1 && !ends.length; y++) for (let x = 1; x < w-1; x++)
      if (skel[key(x, y)]) { ends.push([x, y]); break; }
  }
  for (const [sx, sy] of ends) {
    for (const first of nb(sx, sy)) {
      const tag = key(sx, sy) + ':' + key(first[0], first[1]);
      if (seen.has(tag)) continue;
      seen.add(tag);
      let prev = [sx, sy], cur = first, len = Math.hypot(first[0]-sx, first[1]-sy);
      let guard = 0;
      while (!isNode(cur[0], cur[1]) && guard++ < 100000) {
        const next = nb(cur[0], cur[1]).find(p => p[0] !== prev[0] || p[1] !== prev[1]);
        if (!next) break;
        len += Math.hypot(next[0]-cur[0], next[1]-cur[1]);
        prev = cur; cur = next;
      }
      seen.add(key(cur[0], cur[1]) + ':' + key(prev[0], prev[1]));
      const a = nid(sx, sy), b = nid(cur[0], cur[1]);
      if (a !== b && len > 0) edges.push([a, b, +(len/scale).toFixed(1)]);
    }
  }
  return { nodes, edges };
}

/* ---------- legend ---------- */
function legendBands(im) {
  const { data, w, h } = im;
  const W = Math.floor(w*0.20), H = Math.floor(h*0.45);
  const rows = [];
  for (let y = 0; y < H; y++) {
    const cols = [];
    for (let x = 0; x < W; x++) {
      const i = (y*w + x)*4, mx = maxc(data, i), mn = minc(data, i);
      if (mx > 0x50 && mx - mn > 12) cols.push([data[i], data[i+1], data[i+2]]);
    }
    rows.push(cols.length < 40 ? null : median(cols));
  }
  const bands = []; let start = null, cur = null;
  for (let y = 0; y <= H; y++) {
    const c = y < H ? rows[y] : null;
    if (cur && c && dist3(c, cur) < 40) { cur = mix(cur, c); continue; }
    if (cur && start !== null && y - start >= 6) {
      const seg = rows.slice(start, y).filter(Boolean);
      if (seg.length) bands.push(median(seg));
    }
    start = c ? y : null; cur = c || null;
  }
  // merge neighbours that are near-identical (a gradient splits one swatch)
  const out = [];
  for (const b of bands) if (!out.length || dist3(out[out.length-1], b) >= 40) out.push(b);
  return { bands: out, box: [Math.round(H*0.0), W] };
}
const median = a => [0,1,2].map(k => { const v = a.map(p => p[k]).sort((x,y)=>x-y); return v[Math.floor(v.length/2)]; });
const dist3 = (a, b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
const mix = (a, b) => [0,1,2].map(k => a[k]*0.7 + b[k]*0.3);

/* ---------- shop units ---------- */
function units(im, bands, legendH) {
  const { data, w, h, scale } = im, N = w*h;
  const MIN_UNIT = Math.max(60, Math.round(MIN_UNIT_FULL * scale * scale));
  const body = new Uint8Array(N);
  const lx = Math.floor(w*0.20), ly = legendH;
  for (let p = 0; p < N; p++) {
    const i = p*4;
    if (maxc(data, i) <= DARK || minc(data, i) >= WHITE) continue;
    const x = p % w, y = (p - x) / w;
    if (x < lx && y < ly) continue;                 // legend block is not a shop
    body[p] = 1;
  }
  const lab = new Int32Array(N).fill(-1);
  const out = [];
  for (let s = 0; s < N; s++) {
    if (!body[s] || lab[s] !== -1) continue;
    const id = out.length, q = [s]; lab[s] = id;   // label == slot index in `out`
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < q.length; i++) {
      const p = q[i], x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny*w+nx;
        if (body[np] && lab[np] === -1) { lab[np] = id; q.push(np); }
      }
    }
    const bw = x1-x0+1, bh = y1-y0+1;
    if (q.length < MIN_UNIT || q.length / (bw*bh) < MIN_FILL) { out.push(null); continue; }
    // NB: `id` above is the index into `out`, which includes rejected slots, so it
    // stays a valid label for this component.
    const cols = [];
    for (let i = 0; i < q.length; i += Math.max(1, q.length >> 8)) {
      const j = q[i]*4; cols.push([data[j], data[j+1], data[j+2]]);
    }
    const rgb = median(cols);
    let cat = 0, bd = 1e9;
    bands.forEach((b, k) => { const d = dist3(b, rgb); if (d < bd) { bd = d; cat = k; } });
    out.push({ labId: id, px: q.length, rgb, cat, bbox: [x0, y0, x1, y1],
               pts: q, c: null });
  }
  const kept = out.filter(Boolean);
  for (const u of kept) { u.c = deepest(u, w, scale); delete u.pts; }
  // The sheet itself is the map, so shapes are never redrawn. What IS needed is
  // "which shop did the user click", and a label map answers that exactly.
  return { list: kept, lab, lw: w, lh: h };
}

/* A centre of mass falls outside an L-shaped unit; use the deepest interior
   point so the label and the walkway snap both land inside the shop. */
function deepest(u, w, scale) {
  const set = new Set(u.pts);
  const [x0, y0, x1, y1] = u.bbox, bw = x1-x0+1, bh = y1-y0+1;
  const d = new Int32Array(bw*bh).fill(-1), q = [];
  for (const p of u.pts) {
    const x = p % w, y = (p - x) / w;
    let edge = false;
    for (let k = 0; k < 4 && !edge; k++) {
      const nx = x + [1,-1,0,0][k], ny = y + [0,0,1,-1][k];
      if (!set.has(ny*w + nx)) edge = true;
    }
    if (edge) { const i = (y-y0)*bw + (x-x0); d[i] = 0; q.push([x, y]); }
  }
  let bestP = [x0 + (bw>>1), y0 + (bh>>1)], bestD = -1;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], cd = d[(y-y0)*bw + (x-x0)];
    if (cd > bestD) { bestD = cd; bestP = [x, y]; }
    for (let k = 0; k < 4; k++) {
      const nx = x + [1,-1,0,0][k], ny = y + [0,0,1,-1][k];
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      if (!set.has(ny*w + nx)) continue;
      const j = (ny-y0)*bw + (nx-x0);
      if (d[j] === -1) { d[j] = cd + 1; q.push([nx, ny]); }
    }
  }
  return [Math.round(bestP[0]/scale), Math.round(bestP[1]/scale)];
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const a = pts[0], b = pts[pts.length-1];
  for (let i = 1; i < pts.length-1; i++) {
    const vx = b[0]-a[0], vy = b[1]-a[1];
    const t = Math.max(0, Math.min(1, ((pts[i][0]-a[0])*vx + (pts[i][1]-a[1])*vy) / ((vx*vx+vy*vy)||1e-9)));
    const d = Math.hypot(pts[i][0]-(a[0]+t*vx), pts[i][1]-(a[1]+t*vy));
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return rdp(pts.slice(0, idx+1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

/* ---------- one sheet ---------- */
async function extractSheet(img, onStep) {
  const step = async (msg, fn) => { onStep && onStep(msg); await new Promise(r => setTimeout(r, 12)); return fn(); };
  const im = await step('Reading the image', () => toWorking(img));
  const lg = await step('Reading the legend', () => legendBands(im));
  let walk = await step('Finding the walkable concourse', () => walkable(im));
  walk = await step('Sealing hairline gaps', () => close(walk, im.w, im.h, 2));
  const skel = await step('Thinning it to a centre line', () => skeletonize(walk, im.w, im.h));
  const g = await step('Building the walk graph', () => graphOf(skel, im.w, im.h, im.scale));
  const U = await step('Finding the shops', () => units(im, lg.bands, Math.floor(im.h*0.45)));
  const us = U.list;
  await step('Attaching shops to the walkway', () => {
    for (const u of us) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < g.nodes.length; i++) {
        const d = Math.hypot(g.nodes[i][0]-u.c[0], g.nodes[i][1]-u.c[1]);
        if (d < bd) { bd = d; bi = i; }
      }
      u.v = bi; u.snap = Math.round(bd);
    }
  });
  return { size: im.full, scale: im.scale, nodes: g.nodes, edges: g.edges, units: us,
           lab: U.lab, lw: U.lw, lh: U.lh,
           legend: lg.bands.map(b => b.map(Math.round)) };
}
