/* ---------- UI ---------- */
const SITES={}; for(const k in V.sites) SITES[k]=new Site(V.sites[k]);
const SITE_IDS=Object.keys(SITES).sort();
let siteId=SITE_IDS.includes('T2')?'T2':SITE_IDS[0];
let S=SITES[siteId], cur={from:null,to:null}, activeLevel=null, last=null;
const KIND=k=>(k||'place').replace(/_/g,' ');
const zoneName=z=>(ZONE[z]||{}).name||'Unzoned';

const termBox=document.getElementById('terms');
for(const id of SITE_IDS){
  const b=document.createElement('button');
  b.className='term'; b.textContent=SITES[id].name;
  b.setAttribute('aria-pressed', String(id===siteId));
  b.addEventListener('click',()=>{
    siteId=id; S=SITES[id]; cur={from:null,to:null}; last=null; activeLevel=null;
    fromI.value=''; toI.value='';
    for(const el of termBox.children) el.setAttribute('aria-pressed', String(el.textContent===SITES[id].name));
    buildChips(); render(); drawLevels([]); drawMap();
  });
  termBox.appendChild(b);
}

function combo(id,key){
  const inp=document.getElementById(id), menu=document.getElementById(id+'-menu');
  let items=[], sel=-1;
  const render_=q=>{
    const s=q.trim().toLowerCase();
    const pool=[...S.pois].sort((a,b)=>(b.s-a.s)||a.n.localeCompare(b.n));
    items=(s?pool.filter(p=>p.n.toLowerCase().includes(s)):pool).slice(0,60);
    menu.innerHTML= items.length ? items.map((p,i)=>
      `<div class="opt${i===sel?' sel':''}" data-i="${i}"><span class="nm">${esc(p.n)}</span>
       <span class="kd">${esc(KIND(p.k))}</span>
       <span class="zpill z-${esc(p.z||'none')}">${esc((ZONE[p.z]||{}).short||'—')}</span>
       <span class="lv">L${esc(p.l)}</span></div>`).join('')
      : '<div class="opt"><span class="nm" style="color:var(--muted)">Nothing matches that.</span></div>';
    menu.classList.add('on');
  };
  const pick=i=>{ if(!items[i])return; cur[key]=items[i]; inp.value=items[i].n; menu.classList.remove('on'); render(); };
  inp.addEventListener('input',()=>{sel=-1; render_(inp.value);});
  inp.addEventListener('focus',()=>render_(inp.value));
  inp.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();
      sel=Math.max(0,Math.min(items.length-1,sel+(e.key==='ArrowDown'?1:-1))); render_(inp.value);
      menu.querySelector('.sel')?.scrollIntoView({block:'nearest'});
    } else if(e.key==='Enter'){e.preventDefault(); pick(sel<0?0:sel);}
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

const find=n=>S.pois.find(p=>p.n===n);
function buildChips(){
  const box=document.getElementById('chips');
  box.innerHTML='<span class="cl">Try</span>';
  const want = siteId==='T2'
    ? [['Domestic Security','KFC'],['CheckIn A1 to A15','Gate C1'],['Belt 1','Gate C1'],['Belt 1','Belt 4']]
    : [['Domestic Security','Gate 1'],['Belt 1','Gate 1']];
  for(const [a,b] of want){
    const A=find(a),Z=find(b); if(!A||!Z) continue;
    const btn=document.createElement('button');
    btn.className='chip'; btn.textContent=`${a} → ${b}`;
    btn.addEventListener('click',()=>{cur.from=A; cur.to=Z; fromI.value=a; toI.value=b; render();});
    box.appendChild(btn);
  }
}

function render(){
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

buildChips();
const A0=find('Domestic Security'), Z0=find('KFC');
if(A0&&Z0){cur.from=A0; cur.to=Z0; fromI.value=A0.n; toI.value=Z0.n;}
render();
