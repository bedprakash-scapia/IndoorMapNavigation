/* ---- narration ---- */
Site.prototype.segments = function(path){
  const segs=[]; let cur=[path[0].n];
  for(let i=1;i<path.length;i++){
    const st=path[i];
    if(st.k){ segs.push(['walk',cur]); segs.push(['move',[cur[cur.length-1],st.n,st.k]]); cur=[st.n]; }
    else cur.push(st.n);
  }
  segs.push(['walk',cur]);
  return segs.filter(s=>s[0]==='move'||s[1].length>1);
};
Site.prototype.straights = function(nodes){
  const pts=thin(rdp(nodes.map(n=>this.xy(n))));
  const runs=[]; let start=0;
  for(let i=1;i<pts.length-1;i++)
    if(Math.abs(turnOf(bearing(pts[i-1],pts[i]),bearing(pts[i],pts[i+1])))>=30){ runs.push(pts.slice(start,i+1)); start=i; }
  runs.push(pts.slice(start));
  return runs.filter(r=>r.length>=2).map(r=>{
    let m=0; for(let j=0;j<r.length-1;j++) m+=dist(r[j],r[j+1]);
    return {pts:r,m};
  });
};
Site.prototype.narrate = function(path,o,d,used,recent,never,lms,zone,opening,closing){
  const steps=[], segs=this.segments(path);
  if(opening){
    const fw=segs.find(s=>s[0]==='walk'); let faced=null;
    if(fw){
      const pts=rdp(fw[1].map(n=>this.xy(n))), lv=this.lvl(fw[1][0]);
      const head=bearing(pts[0],pts[1]); const c=[];
      for(const v of (this.lm[lv]||[])){
        if(used.has(v.n)) continue;
        if(zone && v.z && v.z!==zone) continue;
        const dd=dist(pts[0],v.c); if(dd>60) continue;
        const off=Math.abs(turnOf(head,bearing(pts[0],v.c)));
        if(off<=70) c.push([off,dd,v]);
      }
      c.sort((x,y)=>(y[2].s-x[2].s)||(x[0]-y[0]));
      if(c.length){faced=c[0][2]; used.add(faced.n); lms.push(faced);}
    }
    steps.push({t:'start', html: faced
      ? `Stand at ${B(o.n)} with it behind you, facing ${B(faced.n)}.`
      : `Start at ${B(o.n)}.`});
  }
  let prev=null;
  for(const [kind,payload] of segs){
    if(kind==='move'){
      const [a,b,k]=payload, la=this.lvl(a), lb=this.lvl(b);
      const [anc]=this.corner(this.xy(a),la,used,25,recent,never,zone);
      if(anc){used.add(anc.n); recent.clear(); recent.add(anc.n); lms.push(anc);}
      steps.push({t:'level', html:`Take the ${k===2?'lift':'escalator'}`+
        (anc?` beside ${B(anc.n)}`:'')+` ${(+lb<+la)?'down':'up'} to <b>Level ${esc(lb)}</b>.`});
      prev=null; continue;
    }
    const lv=this.lvl(payload[0]);
    for(const run of this.straights(payload)){
      const pts=run.pts, head=bearing(pts[0],pts[pts.length-1]);
      if(prev!==null){
        const t=turnOf(prev,head);
        if(Math.abs(t)>=14){
          const [anc,reused]=this.corner(pts[0],lv,used,22,recent,never,zone);
          if(anc){used.add(anc.n); recent.clear(); recent.add(anc.n); lms.push(anc);}
          const at = !anc ? '' : reused==='far' ? `, towards ${B(anc.n)}`
                    : reused ? ` just after ${B(anc.n)}` : ` at ${B(anc.n)}`;
          const word=Math.abs(t)>=105?'Turn sharply':Math.abs(t)>=30?'Turn':'Bear';
          steps.push({t:'turn', dir:t>0?'right':'left', html:`${word} ${t>0?'right':'left'}${at}.`});
        }
      }
      const got=this.along(pts,lv,used,run.m>=70?2:1,never,zone);
      for(const h of got){used.add(h.v.n); lms.push(h.v);}
      const dd = run.m>=15 ? `${Math.round(run.m)} m` : null;
      if(got.length===2)
        steps.push({t:'walk', d:dd, html:`Walk past ${B(got[0].v.n)} on your ${got[0].side}, then ${B(got[1].v.n)} on your ${got[1].side}.`});
      else if(got.length)
        steps.push({t:'walk', d:dd, html:`Walk past ${B(got[0].v.n)} on your ${got[0].side}.`});
      else if(dd) steps.push({t:'walk', d:dd, html:'Keep going straight.'});
      prev=head;
    }
  }
  if(closing){
    const ex=new Set([...used,d.n]);
    const nd=this.near(d.c,d.l,30,ex,zone).concat(this.near(d.c,d.l,60,ex,zone));
    steps.push({t:'end', html: nd.length
      ? `${B(d.n)} is right there, next to ${B(nd[0][1].n)}.`
      : `You have arrived at ${B(d.n)}.`});
  }
  return steps;
};
Site.prototype.directions = function(o,d){
  const plan=this.plan(o,d);
  if(!plan.ok) return {blocked:true, reason:plan.reason, zones:plan.zones};
  const never=new Set([o.n,d.n]);
  for(const [a,b] of plan.legs){never.add(a.n); never.add(b.n);}
  const used=new Set(never), recent=new Set();
  let steps=[], total=0, levels=[], lms=[], first=true, portalPois=[];
  for(const [a,b,portal] of plan.legs){
    const r=this.shortest(a.v,b.v);
    if(!r) return {blocked:true, reason:`No walkable path from ${a.n} to ${b.n} in this map data.`, zones:plan.zones};
    total+=r.m;
    steps=steps.concat(this.narrate(r.path,a,b,used,recent,never,lms,a.z,first,!portal));
    levels=levels.concat(r.path.map(s=>this.lvl(s.n)));
    first=false;
    if(portal){
      portalPois.push(b);
      steps.push({t:'portal', html:md(portal.verb.replace('{name}',b.n)), note:portal.note});
    }
  }
  const seq=[]; for(const l of levels) if(!seq.length||seq[seq.length-1]!==l) seq.push(l);
  return {steps, m:total, levels:seq, landmarks:lms, zones:plan.zones, portalPois,
          minutes:Math.max(1,Math.round(total/1.25/60)), path:plan.legs.map(([a,b])=>this.shortest(a.v,b.v).path)};
};

/* ---------- icons ---------- */
const ICON={
  start:'<circle cx="12" cy="12" r="5" fill="currentColor"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  end:'<path d="M12 22s7-7.1 7-12A7 7 0 0 0 5 10c0 4.9 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/>',
  walk:'<path d="M12 21V6M12 6l-5 5M12 6l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  left:'<path d="M17 21v-9a4 4 0 0 0-4-4H7M7 8l4-4M7 8l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  right:'<path d="M7 21v-9a4 4 0 0 1 4-4h6M17 8l-4-4M17 8l-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  level:'<path d="M8 20V5M8 5L4.5 8.5M8 5l3.5 3.5M16 4v15m0 0l3.5-3.5M16 19l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  portal:'<path d="M4 20V4h9v16zM13 12h7m0 0-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  stop:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 15.5l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};
const iconFor=s=>s.t==='start'?ICON.start:s.t==='end'?ICON.end:s.t==='level'?ICON.level
  :s.t==='portal'?ICON.portal:s.t==='turn'?(s.dir==='left'?ICON.left:ICON.right):ICON.walk;
