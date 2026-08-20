/* ---------- UI ---------- */
const SITES={}; for(const k in V.sites) SITES[k]=new Site(V.sites[k]);
const SITE_IDS=Object.keys(SITES).sort();
let siteId=SITE_IDS.includes(new URLSearchParams(location.search).get('t'))
  ? new URLSearchParams(location.search).get('t')
  : (SITE_IDS.includes('T2')?'T2':SITE_IDS[0]);
let S=SITES[siteId], cur={from:null,to:null}, activeLevel=null, last=null;

/* Journey mode. A departing passenger and an arriving one move through
   disjoint parts of the terminal; `public` (forecourt, taxi rank) is the one
   zone both of them legitimately use, so it appears in each. */
const MODES={
  departure:{label:'Departure', zones:['public','landside-dep','airside-dep']},
  arrival:  {label:'Arrival',   zones:['arrivals','public']}
};
const Q=new URLSearchParams(location.search);
let mode=MODES[Q.get('m')]?Q.get('m'):'departure';
const modeZones=()=>MODES[mode].zones;
const inMode=p=>modeZones().includes(p.z);
const modePois=()=>S.pois.filter(inMode);
const KIND=k=>(k||'place').replace(/_/g,' ');
const zoneName=z=>(ZONE[z]||{}).name||'Unzoned';

const termBox=document.getElementById('terms');
for(const id of SITE_IDS){
  const b=document.createElement('button');
  b.className='term'; b.textContent=SITES[id].name;
  b.setAttribute('aria-pressed', String(id===siteId));
  b.addEventListener('click',()=>{
    siteId=id; S=SITES[id];
    for(const el of termBox.children) el.setAttribute('aria-pressed', String(el.textContent===SITES[id].name));
    applyMode();
  });
  termBox.appendChild(b);
}

function combo(id,key){
  const inp=document.getElementById(id), menu=document.getElementById(id+'-menu');
  const other = key==='from' ? 'to' : 'from';
  let items=[], sel=-1;

  /* Grey out anything the zone policy would refuse against whatever is already
     chosen on the other side. walkable() is component-based, so this stays
     cheap enough to redo on every keystroke. */
  const verdict=p=>{
    const o=cur[other]; if(!o) return {ok:true};
    return key==='from' ? S.walkable(p,o) : S.walkable(o,p);
  };
  const render_=q=>{
    const s=q.trim().toLowerCase();
    const pool=modePois().sort((a,b)=>(b.s-a.s)||a.n.localeCompare(b.n));
    items=(s?pool.filter(p=>p.n.toLowerCase().includes(s)):pool).slice(0,60)
            .map(p=>({p, w:verdict(p)}));
    menu.innerHTML= items.length ? items.map(({p,w},i)=>
      `<div class="opt${i===sel?' sel':''}${w.ok?'':' off'}" data-i="${i}"
        ${w.ok?'':`aria-disabled="true" title="${esc(w.why)} from ${esc(cur[other].n)}"`}>
       <span class="nm">${esc(p.n)}</span>
       <span class="kd">${esc(KIND(p.k))}</span>
       ${w.ok?`<span class="zpill z-${esc(p.z||'none')}">${esc((ZONE[p.z]||{}).short||'—')}</span>`
             :`<span class="nowalk">${esc(w.why)}</span>`}
       <span class="lv">L${esc(p.l)}</span></div>`).join('')
      : '<div class="opt"><span class="nm" style="color:var(--muted)">Nothing matches that.</span></div>';
    menu.classList.add('on');
  };
  const pick=i=>{ const it=items[i]; if(!it||!it.w.ok) return;
    cur[key]=it.p; inp.value=it.p.n; menu.classList.remove('on'); render(); };
  /* Arrow keys land only on options that can actually be chosen. */
  const move=d=>{
    for(let i=sel+d; i>=0 && i<items.length; i+=d) if(items[i].w.ok) return i;
    return sel;
  };
  inp.addEventListener('input',()=>{sel=-1; render_(inp.value);});
  inp.addEventListener('focus',()=>{sel=-1; render_(inp.value);});
  inp.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();
      sel=move(e.key==='ArrowDown'?1:-1); render_(inp.value);
      menu.querySelector('.sel')?.scrollIntoView({block:'nearest'});
    } else if(e.key==='Enter'){e.preventDefault();
      pick(sel<0 ? items.findIndex(x=>x.w.ok) : sel);}
    else if(e.key==='Escape') menu.classList.remove('on');
  });
  menu.addEventListener('mousedown',e=>{const o=e.target.closest('.opt'); if(o){e.preventDefault(); pick(+o.dataset.i);}});
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&e.target!==inp) menu.classList.remove('on');});
  return inp;
}
const fromI=combo('from','from'), toI=combo('to','to');
document.getElementById('swap').addEventListener('click',()=>{
  [cur.from,cur.to]=[cur.to,cur.from];
  fromI.value=cur.from?cur.from.n:''; toI.value=cur.to?cur.to.n:''; render();
});

const find=n=>modePois().find(p=>p.n===n);
function buildChips(){
  const box=document.getElementById('chips');
  box.innerHTML='<span class="cl">Try</span>';
  for(const [a,b] of (CHIPS[siteId]||{})[mode]||[]){
    const A=find(a),Z=find(b); if(!A||!Z) continue;
    const btn=document.createElement('button');
    btn.className='chip'; btn.textContent=`${a} \u2192 ${b}`;
    btn.addEventListener('click',()=>{cur.from=A; cur.to=Z; fromI.value=a; toI.value=b; render();});
    box.appendChild(btn);
  }
}

/* Suggested journeys per terminal and mode. Any pair naming a POI this
   terminal does not have is skipped, so a missing name degrades to one
   fewer chip rather than a broken button. */
const CHIPS={
  T2:{departure:[['Subway','CheckIn E1 to E15'],['CheckIn A1 to A15','Gate C1'],['Domestic Security','KFC']],
      arrival:  [['Belt 1','Belt 4'],['Belt 5','Exit Gate 4'],['Belt 3','Care by BLR']]},
  T1:{departure:[['Checkin Counters','Gate 1'],['Domestic Security','Gate 1'],['Self Baggage Drop','Gate 12']],
      arrival:  [['Belt 1','Belt 4'],['Belt 3','Lost and Found'],['Belt 2','Arrival Hall Infodesk']]}
};

/* Where a mode is not fully modelled for a terminal, say so rather than
   letting the user discover it as a dead end. */
function modeNote(){
  const box=document.getElementById('modenote');
  const pois=modePois();
  const hasExit=(S.portals||[]).some(pt=>pt.frm==='arrivals'&&(pt.cand||[]).length);
  let msg='';
  if(!pois.length){
    msg=`<b>No ${MODES[mode].label.toLowerCase()} places mapped in ${S.name}.</b> Try the other terminal.`;
  } else if(mode==='arrival'&&!hasExit){
    msg=`<b>${S.name} arrivals is baggage reclaim only.</b> The published map has no `+
        `modelled exit from reclaim to the forecourt here, so routes stop at the belts.`;
  }
  box.innerHTML=msg;
}


function render(){
  try{ renderRoute(); } finally { syncNav(); }
}
function renderRoute(){
  const out=document.getElementById('out'), sum=document.getElementById('sum');
  if(!cur.from||!cur.to){ out.innerHTML='<div class="empty">Pick where you are and where you are going.</div>'; sum.innerHTML=''; last=null; drawMap(); return; }
  if(cur.from.n===cur.to.n){ out.innerHTML='<div class="empty">You are already there.</div>'; sum.innerHTML=''; last=null; drawMap(); return; }
  const r=S.directions(cur.from,cur.to); last=r;
  if(r.blocked){
    sum.innerHTML='';
    out.innerHTML=`<div class="blocked">
      <span class="glyph"><svg viewBox="0 0 24 24">${ICON.stop}</svg></span>
      <span><span class="bt">Not walkable</span>${esc(r.reason)}
      <span class="pnote">${esc(cur.from.n)} is in ${esc(zoneName(cur.from.z))}; ${esc(cur.to.n)} is in ${esc(zoneName(cur.to.z))}.</span></span></div>`;
    activeLevel=cur.from.l; drawLevels([cur.from.l]); drawMap(); drawZones(); return;
  }
  sum.innerHTML=`<div class="summary">
    <div><span class="k">Walk time</span><span class="v">~${r.minutes} min</span></div>
    <div><span class="k">Distance</span><span class="v">${Math.round(r.m)} m</span></div>
    <div><span class="k">Levels</span><span class="v">${r.levels.join(' → ')}</span></div>
    <div><span class="k">Steps</span><span class="v">${r.steps.length}</span></div></div>`;
  out.innerHTML='<ol class="steps">'+r.steps.map((s,i)=>
    `<li class="is-${s.t}">
      <span class="glyph"><svg viewBox="0 0 24 24">${iconFor(s)}</svg></span>
      <span class="txt">${s.html}${s.note?`<span class="pnote">${esc(s.note)}</span>`:''}</span>
      ${s.d?`<span class="dist">${s.d}</span>`:'<span></span>'}
    </li>`).join('')+'</ol>';
  activeLevel=r.levels[0]; drawLevels(r.levels); drawMap(); drawZones();
}

/* Hand the current selection to the turn-by-turn view. Hidden whenever there
   is nothing walkable to hand over. */
function navUrl(){
  return 'navigate.html?'+new URLSearchParams({t:siteId, m:mode, from:cur.from.n, to:cur.to.n});
}
function syncNav(){
  const ok=cur.from&&cur.to&&last&&!last.blocked;
  document.getElementById('navrow').hidden=!ok;
  if(ok) document.getElementById('startnav').href=navUrl();
}
/* A phone-shaped window, so the turn-by-turn view can be demoed at the size it
   was designed for without leaving the map. */
document.getElementById('mobilebtn').addEventListener('click',()=>{
  /* Always available: the mobile view has its own picker, so it does not need
     a route to have been chosen here. */
  const q=new URLSearchParams({t:siteId, m:mode});
  if(cur.from&&cur.to&&last&&!last.blocked){ q.set('from',cur.from.n); q.set('to',cur.to.n); }
  const url='navigate.html?'+q;
  const w=402, h=874;
  /* availLeft/availTop are absent in some engines; without the guard the whole
     expression is NaN and the window opens at the default position. */
  const x=(screen.availLeft||0)+screen.availWidth-w-40, y=(screen.availTop||0)+40;
  const win=window.open(url,'blr-phone',
    `width=${w},height=${h},left=${x},top=${y},menubar=no,toolbar=no,location=no,status=no`);
  if(win) win.focus(); else location.href=url;   /* popup blocked: just go */
});

function drawZones(){
  const box=document.getElementById('zonebar');
  if(!last||last.blocked===undefined&&!last.zones){box.innerHTML=''; return;}
  const zs=(last.zones||[]).filter(Boolean);
  box.innerHTML = zs.length ? zs.map(z=>
    `<span class="zi"><span class="zpill z-${esc(z)}">${esc((ZONE[z]||{}).short||'—')}</span>${esc(zoneName(z))}</span>`).join('') : '';
}

function drawLevels(levels){
  const box=document.getElementById('lvls');
  box.innerHTML='<span class="cl">Level</span>';
  const ls = levels.length?levels:[...new Set(S.nodes.map(n=>n[2]))].sort();
  for(const lv of ls){
    const b=document.createElement('button');
    b.className='lvl'; b.textContent=lv; b.setAttribute('aria-pressed',String(lv===activeLevel));
    b.addEventListener('click',()=>{activeLevel=lv; drawLevels(levels); drawMap();});
    box.appendChild(b);
  }
}

let PROJ=null;
function proj(){
  const LO=S.nodes.map(n=>n[0]), LA=S.nodes.map(n=>n[1]);
  const X0=Math.min(...LO),X1=Math.max(...LO),Y0=Math.min(...LA),Y1=Math.max(...LA);
  const KX=Math.cos((Y0+Y1)/2*D2R), W=600,H=460,P=16;
  const sc=Math.min((W-2*P)/(((X1-X0)*KX)||1e-9),(H-2*P)/((Y1-Y0)||1e-9));
  return p=>[P+(p[0]-X0)*KX*sc, H-P-(p[1]-Y0)*sc];
}
function drawMap(){
  const svg=document.getElementById('map');
  PROJ=proj(); const px=PROJ, lv=activeLevel;
  if(lv==null){svg.innerHTML=''; return;}
  let s='';
  for(const [a,b,,tr] of S.edges){
    if(tr||S.lvl(a)!==lv||S.lvl(b)!==lv) continue;
    const [x1,y1]=px(S.xy(a)),[x2,y2]=px(S.xy(b));
    s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--map-path)" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  if(last&&!last.blocked&&last.path){
    for(const leg of last.path){
      let run=[];
      const flush=()=>{ if(run.length>1) s+=`<polyline points="${run.map(p=>px(p).map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--gold-bright)" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>`; run=[]; };
      for(const st of leg){ if(S.lvl(st.n)===lv) run.push(S.xy(st.n)); else flush(); }
      flush();
    }
    for(const v of last.landmarks){
      if(v.l!==lv) continue;
      const [x,y]=px(v.c);
      s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="var(--green)"/>`;
    }
    for(const v of (last.portalPois||[])){
      if(v.l!==lv) continue;
      const [x,y]=px(v.c);
      s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="var(--stop)" stroke="var(--map-bg)" stroke-width="2.2"/>`;
    }
  }
  for(const [poi,col] of [[cur.from,'var(--ink)'],[cur.to,'var(--gold-bright)']]){
    if(!poi||poi.l!==lv) continue;
    const [x,y]=px(poi.c);
    s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${col}" stroke="var(--map-bg)" stroke-width="2.4"/>`;
  }
  svg.innerHTML=s;
}

function applyMode(){
  cur={from:null,to:null}; last=null; activeLevel=null;
  fromI.value=''; toI.value='';
  buildChips(); modeNote(); seed(); render(); drawLevels([]); drawMap();
}
document.getElementById('mode').value=mode;
document.getElementById('mode').addEventListener('change',e=>{ mode=e.target.value; applyMode(); });

/* Open on a journey that exercises the mode, not just the first two POIs. */
function seed(){
  const pick=(CHIPS[siteId]||{})[mode]||[];
  for(const [a,b] of pick){
    const A=find(a),Z=find(b);
    if(A&&Z){ cur.from=A; cur.to=Z; fromI.value=a; toI.value=b; return; }
  }
}
applyMode();
