/* ---------- turn-by-turn ---------- */
const P=new URLSearchParams(location.search);
const view=document.getElementById('view');
const SITES={}; for(const k in V.sites) SITES[k]=new Site(V.sites[k]);
const SITE_IDS=Object.keys(SITES).sort();

const MODES={
  departure:{label:'Departure', zones:['public','landside-dep','airside-dep']},
  arrival:  {label:'Arrival',   zones:['arrivals','public']}
};

const unesc=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const bolds=h=>[...h.matchAll(/<b>(.*?)<\/b>/g)].map(m=>unesc(m[1]));
const metres=s=>{const m=/([\d.]+)\s*m/.exec(s&&s.d||''); return m?+m[1]:0;};
const mins=m=>Math.max(1, Math.round(m/1.25/60));

/* ---------- picker state ---------- */
let siteId = SITES[P.get('t')] ? P.get('t') : (SITES.T2 ? 'T2' : SITE_IDS[0]);
let S = SITES[siteId];
let mode = MODES[P.get('m')] ? P.get('m') : 'departure';
let O=null, D=null, facing=null;
let ROUTE=null, HEAD=null, CHOICES=[];

const inMode=p=>MODES[mode].zones.includes(p.z);
const modePois=()=>S.pois.filter(inMode);
const byName=n=>modePois().find(p=>p.n===n);
/* Options are keyed by index, not name: the data holds several distinct POIs
   sharing a name (two "Water Station"s in T2), and picking one must not
   silently resolve to the other. */
const byIdx=i=>S.pois[+i];
const idxOf=p=>S.pois.indexOf(p);

/* Everything the current pair implies: the route, the opening heading, and
   what you could be looking at. Recomputed whenever a picker changes. */
function recompute(){
  ROUTE = (O&&D&&O!==D) ? S.directions(O,D) : null;
  if(ROUTE && !ROUTE.blocked){
    HEAD=S.openingHeading(ROUTE);
    /* Not the destination: "face where you are going" is not an orientation
       cue, it is the answer. */
    CHOICES=S.facingChoices(O).filter(c=>c.v!==D);
    if(!CHOICES.some(c=>c.v===facing)) facing = CHOICES.length?CHOICES[0].v:null;
  } else { HEAD=null; CHOICES=[]; facing=null; }
}

/* Open on a journey worth showing: MODES lists zones in the order a passenger
   passes through them, so seed the start from the earliest zone and the
   destination from the latest. Venue-agnostic — no POI names here. */
function seedPair(){
  const pool=modePois();
  if(!pool.length){ O=D=null; return; }
  const zones=MODES[mode].zones;
  const best=z=>pool.filter(p=>p.z===z).sort((a,b)=>(b.s-a.s)||a.n.localeCompare(b.n));
  if(!O || !inMode(O))
    for(const z of zones){ const c=best(z); if(c.length){ O=c[0]; break; } }
  if(!O) O=pool[0];
  if(!D || !inMode(D) || D===O || !S.walkable(O,D).ok){
    D=null;
    for(const z of [...zones].reverse()){
      const c=best(z).find(p=>p!==O && S.walkable(O,p).ok);
      if(c){ D=c; break; }
    }
    if(!D) D = pool.find(p=>p!==O && S.walkable(O,p).ok) || null;
  }
}

function syncUrl(){
  const q=new URLSearchParams({t:siteId, m:mode});
  if(O) q.set('from',O.n); if(D) q.set('to',D.n);
  history.replaceState(null,'','?'+q);
  document.getElementById('back').href='index.html?'+new URLSearchParams({t:siteId,m:mode});
  document.getElementById('ttl').textContent=`${S.name} · ${MODES[mode].label}`;
}

/* ---------- the picker ---------- */
/* Options are grouped by zone and sorted by landmark score, and anything the
   zone policy would refuse against the other endpoint is rendered `disabled` —
   the browser greys it out and will not let it be chosen. */
function options(sel, other, dir){
  const pool=modePois(), groups={}, seen={};
  for(const p of pool){ seen[p.n]=(seen[p.n]||0)+1; }
  for(const p of pool){
    const z=(ZONE[p.z]||{}).name||'Elsewhere';
    (groups[z] ||= []).push(p);
  }
  let html='';
  for(const z of Object.keys(groups).sort()){
    html+=`<optgroup label="${esc(z)}">`;
    for(const p of groups[z].sort((a,b)=>(b.s-a.s)||a.n.localeCompare(b.n))){
      let off=false, why='';
      if(other && p!==other){
        const w = dir==='from' ? S.walkable(p,other) : S.walkable(other,p);
        if(!w.ok){ off=true; why=' — '+w.why.toLowerCase(); }
      }
      if(p===other){ off=true; why=' — already chosen'; }
      /* Repeated names get their level, so the two are told apart. */
      const label = p.n + (seen[p.n]>1 ? ` · Level ${p.l}` : '') + why;
      html+=`<option value="${idxOf(p)}"${p===sel?' selected':''}${off?' disabled':''}
        >${esc(label)}</option>`;
    }
    html+='</optgroup>';
  }
  return html || '<option disabled>Nothing mapped here</option>';
}

function setup(){
  recompute();
  syncUrl();
  const ok = ROUTE && !ROUTE.blocked;
  const zn=z=>(ZONE[z]||{}).name||'Unzoned';
  view.innerHTML=`
    ${ok?`<div class="stats">
      <div class="stat"><span class="v">~${ROUTE.minutes}</span><span class="k">min</span></div>
      <div class="stat"><span class="v">${Math.round(ROUTE.m)}</span><span class="k">metres</span></div>
      <div class="stat"><span class="v">${esc(ROUTE.levels.join('→'))}</span><span class="k">${ROUTE.levels.length>1?'levels':'level'}</span></div>
      <div class="stat"><span class="v">${ROUTE.steps.length}</span><span class="k">steps</span></div>
    </div>`:''}
    <div class="setup">
      <h2>Where are you going?</h2>
      <div class="row2">
        <div><label for="site">Terminal</label>
          <select id="site">${SITE_IDS.map(id=>
            `<option value="${esc(id)}"${id===siteId?' selected':''}>${esc(SITES[id].name)}</option>`).join('')}</select></div>
        <div><label for="mode">Journey</label>
          <select id="mode">${Object.keys(MODES).map(k=>
            `<option value="${k}"${k===mode?' selected':''}>${MODES[k].label}</option>`).join('')}</select></div>
      </div>
      <label for="from">Where you are now</label>
      <select id="from">${options(O, D, 'from')}</select>
      <label for="to">Where you want to go</label>
      <select id="to">${options(D, O, 'to')}</select>
      ${ok?`<label for="facing">And you can see, straight ahead</label>
        <select id="facing">
          ${CHOICES.map((c,i)=>`<option value="${i}"${c.v===facing?' selected':''}
            >${esc(c.v.n)} · ${Math.round(c.d)} m away</option>`).join('')}
          <option value="-1"${facing?'':' selected'}>I'm not sure</option>
        </select>`:''}
      ${ROUTE&&ROUTE.blocked?`<div class="warn">
        <b>You cannot walk that.</b> ${esc(ROUTE.reason)}
        <span class="zs">${esc(O.n)} is in ${esc(zn(O.z))}; ${esc(D.n)} is in ${esc(zn(D.z))}.</span>
      </div>`:''}
      ${!O||!D?`<div class="warn"><b>Pick a start and a destination.</b>
        ${esc(S.name)} has nothing mapped for this journey.</div>`:''}
      <button class="go" id="start"${ok?'':' disabled'}>Start walking</button>
    </div>`;

  const on=(id,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener('change',fn);};
  on('site',e=>{ siteId=e.target.value; S=SITES[siteId]; O=D=facing=null; seedPair(); setup(); });
  on('mode',e=>{ mode=e.target.value; O=D=facing=null; seedPair(); setup(); });
  on('from',e=>{ O=byIdx(e.target.value); if(D&&!S.walkable(O,D).ok) D=null; seedPair(); setup(); });
  on('to',  e=>{ D=byIdx(e.target.value); setup(); });
  on('facing',e=>{ const i=+e.target.value; facing = i>=0 ? CHOICES[i].v : null; });
  const go=document.getElementById('start');
  if(go) go.addEventListener('click',()=>{ if(ROUTE&&!ROUTE.blocked) run(facing); });
}

/* ---- the run ---- */
let STEPS=[], LVL=[], i=0, TOTM=0, SCALE=0;

function run(facing){
  STEPS = ROUTE.steps.slice();
  const f = facingStep(O, facing, HEAD);
  if(f) STEPS[0] = f;                    /* replaces the auto-derived opener */

  /* Level at each step: starts on the origin's, advances at every lift or
     escalator step. */
  LVL=[]; let li=0;
  for(const s of STEPS){ if(s.t==='level') li=Math.min(li+1, ROUTE.levels.length-1); LVL.push(ROUTE.levels[li]); }

  TOTM=0; for(const s of STEPS) TOTM+=metres(s);
  SCALE = TOTM>0 ? ROUTE.m/TOTM : 0;

  view.innerHTML=`
    <div class="sticky-top">
      <div class="stats" id="stats"></div>
      <div class="prog"><i id="bar"></i></div>
    </div>
    <div class="list"><ol class="steps" id="ol"></ol></div>
    <div class="ctrl">
      <button class="nav-btn" id="prev">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Back</button>
      <button class="nav-btn primary" id="next">Next
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>`;

  document.getElementById('ol').innerHTML = STEPS.map((s,n)=>li_(s,n)).join('');
  document.getElementById('prev').addEventListener('click',()=>go(i-1));
  document.getElementById('next').addEventListener('click',()=>go(i+1));
  document.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault(); go(i+1);}
    if(e.key==='ArrowLeft'){e.preventDefault(); go(i-1);}
  });
  go(0, false);
}

/* A step shows the shop it names. Only when it names none does the disc fall
   back to the manoeuvre itself. */
function iconOf(s){
  const poi = s.poi || bolds(s.html).map(n=>S.pois.find(p=>p.n===n)).find(Boolean);
  const move = s.t==='face'?s.dir : s.t==='turn'?s.dir : s.t==='level'?'level'
             : s.t==='portal'?'portal' : s.t==='start'?'start' : s.t==='end'?'end' : 'ahead';
  if(poi) return {cat:catOf(poi), glyph:GLYPH[catOf(poi)], badge:MOVE[move], filled:true};
  const cat = s.t==='level'?'facility' : s.t==='portal'?'security'
            : s.t==='end'?'gate' : s.t==='start'||s.t==='face'?'checkin' : 'place';
  return {cat, glyph:MOVE[move], badge:null, filled:false};
}

function li_(s,n){
  const ic=iconOf(s);
  return `<li class="step" data-n="${n}">
    <span class="disc" style="--tint:var(--${ic.cat}); --tint-bg:color-mix(in srgb, var(--${ic.cat}) 15%, transparent)">
      <svg viewBox="0 0 24 24" ${ic.filled?'fill="currentColor"':'fill="none"'}>${ic.glyph}</svg>
      ${ic.badge?`<span class="badge"><svg viewBox="0 0 24 24">${ic.badge}</svg></span>`:''}
    </span>
    <span class="body">
      <span class="txt">${s.html}</span>
      ${s.d?`<span class="meta">${esc(s.d)}</span>`:''}
      ${s.note?`<span class="note">${esc(s.note)}</span>`:''}
    </span></li>`;
}

function go(n, smooth=true){
  i=Math.max(0, Math.min(STEPS.length-1, n));
  const items=document.querySelectorAll('li.step');
  items.forEach((el,n2)=>{
    const d=n2-i;
    el.className='step'+(d===0?' on':Math.abs(d)===1?' n1':Math.abs(d)===2?' n2':d<0?' done':'');
  });
  items[i].scrollIntoView({block:'center', behavior:smooth?'smooth':'auto'});

  let left=0; for(let k=i;k<STEPS.length;k++) left+=metres(STEPS[k]);
  left*=SCALE;
  const last=i===STEPS.length-1;
  document.getElementById('stats').innerHTML=`
    <div class="stat"><span class="v">${last?'0':'~'+mins(left)}</span><span class="k">min left</span></div>
    <div class="stat"><span class="v">${Math.round(left)}</span><span class="k">m left</span></div>
    <div class="stat"><span class="v">${esc(LVL[i])}</span><span class="k">level</span></div>
    <div class="stat"><span class="v">${i+1}<span style="color:var(--muted);font-weight:400">/${STEPS.length}</span></span><span class="k">step</span></div>`;
  document.getElementById('bar').style.width=((i+1)/STEPS.length*100)+'%';
  document.getElementById('prev').disabled = i===0;
  const nx=document.getElementById('next');
  nx.disabled = last;
  nx.firstChild.nodeValue = last ? 'Arrived' : 'Next';
  nx.querySelector('svg').style.display = last ? 'none' : '';
}

/* Boot: honour whatever the URL supplied, then fill any gap with a pair that
   actually routes. */
O = byName(P.get('from')) || null;
D = byName(P.get('to'))   || null;
if(!O || !D) seedPair();
setup();
