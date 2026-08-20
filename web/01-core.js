const V = __VENUE_DATA__;
const D2R = Math.PI/180, R = 6371000;
const ZONE = {}; for(const z of V.zones) ZONE[z.id] = z;

function dist(a,b){
  const dx=(b[0]-a[0])*D2R*Math.cos((a[1]+b[1])/2*D2R)*R, dy=(b[1]-a[1])*D2R*R;
  return Math.hypot(dx,dy);
}
const bearing=(a,b)=>(Math.atan2((b[0]-a[0])*D2R*Math.cos(a[1]*D2R),(b[1]-a[1])*D2R)/D2R+360)%360;
const turnOf=(b0,b1)=>((b1-b0+540)%360)-180;
function perp(p,a,b){
  if(a[0]===b[0]&&a[1]===b[1]) return dist(p,a);
  const k=Math.cos(a[1]*D2R), M=q=>[(q[0]-a[0])*k*111320,(q[1]-a[1])*111320];
  const [px,py]=M(p),[bx,by]=M(b);
  const t=Math.max(0,Math.min(1,(px*bx+py*by)/((bx*bx+by*by)||1e-9)));
  return Math.hypot(px-t*bx,py-t*by);
}
function rdp(pts,eps=4){
  if(pts.length<3) return pts;
  let dmax=0,idx=0;
  for(let i=1;i<pts.length-1;i++){const d=perp(pts[i],pts[0],pts[pts.length-1]); if(d>dmax){dmax=d;idx=i;}}
  if(dmax<=eps) return [pts[0],pts[pts.length-1]];
  return rdp(pts.slice(0,idx+1),eps).slice(0,-1).concat(rdp(pts.slice(idx),eps));
}
function thin(pts,min=7){
  if(pts.length<3) return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++) if(dist(out[out.length-1],pts[i])>=min) out.push(pts[i]);
  out.push(pts[pts.length-1]);
  if(out.length>2 && dist(out[out.length-2],out[out.length-1])<min) out.splice(out.length-2,1);
  return out;
}
const sideOf=(p0,p1,lm)=>turnOf(bearing(p0,p1),bearing(p0,lm))<0?'left':'right';
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const B=s=>'<b>'+esc(s)+'</b>';
const md=h=>h.replace(/\*\*(.+?)\*\*/g,(_,x)=>'<b>'+esc(x)+'</b>');

/* ---------- a site: graph + zone policy + narration ---------- */
class Site{
  constructor(raw){
    Object.assign(this, raw);
    this.adj = this.nodes.map(()=>[]);
    for(const [a,b,w,tr,el] of this.edges){ this.adj[a].push([b,w,tr,el]); this.adj[b].push([a,w,tr,el]); }
    this.comp = new Int32Array(this.nodes.length).fill(-1);
    let c=0;
    for(let s=0;s<this.nodes.length;s++){
      if(this.comp[s]!==-1||!this.adj[s].length) continue;
      const st=[s]; this.comp[s]=c;
      while(st.length){const u=st.pop(); for(const [v] of this.adj[u]) if(this.comp[v]===-1){this.comp[v]=c; st.push(v);}}
      c++;
    }
    this.lm={};
    for(const p of this.pois) if(p.s>0) (this.lm[p.l] ||= []).push(p);
    this.portalPoi = new Set();
    for(const pt of this.portals) for(const i of pt.cand) this.portalPoi.add(i);
  }
  X(i){return this.nodes[i][0]} Y(i){return this.nodes[i][1]}
  xy(i){return [this.nodes[i][0],this.nodes[i][1]]} lvl(i){return this.nodes[i][2]}

  shortest(a,b){
    const N=this.nodes.length, D=new Float64Array(N).fill(Infinity),
          P=new Int32Array(N).fill(-1), K=new Int32Array(N).fill(0), done=new Uint8Array(N);
    D[a]=0; const pq=[[0,a]];
    while(pq.length){
      pq.sort((x,y)=>y[0]-x[0]);
      const [d,u]=pq.pop();
      if(done[u]) continue; done[u]=1;
      if(u===b) break;
      for(const [v,w,tr,el] of this.adj[u]) if(!done[v]&&d+w<D[v]){D[v]=d+w;P[v]=u;K[v]=tr?(el?2:1):0;pq.push([D[v],v]);}
    }
    if(D[b]===Infinity) return null;
    const path=[]; let cu=b;
    while(cu!==-1){ path.push({n:cu,k:K[cu]}); cu=P[cu]; }
    path.reverse(); if(path.length) path[0].k=0;
    return {path, m:D[b]};
  }

  /* landmark helpers */
  near(pt,lv,radius,ex,zone){
    const out=[];
    for(const v of (this.lm[lv]||[])){
      if(ex.has(v.n)) continue;
      if(zone && v.z && v.z!==zone) continue;
      const d=dist(pt,v.c); if(d<=radius) out.push([d,v]);
    }
    out.sort((x,y)=>(y[1].s-x[1].s)||(x[0]-y[0]));
    return out;
  }
  corner(pt,lv,used,radius,recent,never,zone){
    for(const r of [radius,radius*2,radius*3]){
      const c=this.near(pt,lv,r,used,zone); if(c.length) return [c[0][1], r>radius?'far':false];
    }
    const ex=new Set([...recent,...never]);
    for(const r of [radius,radius*2,radius*3]){
      const c=this.near(pt,lv,r,ex,zone); if(c.length) return [c[0][1], r>radius?'far':true];
    }
    return [null,false];
  }
  along(pts,lv,used,limit,never,zone){
    const scan=ex=>{
      const hits=[];
      for(const v of (this.lm[lv]||[])){
        if(ex.has(v.n)) continue;
        if(zone && v.z && v.z!==zone) continue;
        let bj=0,bd=Infinity;
        for(let j=0;j<pts.length-1;j++){const d=perp(v.c,pts[j],pts[j+1]); if(d<bd){bd=d;bj=j;}}
        if(bd>20) continue;
        let at=0; for(let k=0;k<bj;k++) at+=dist(pts[k],pts[k+1]);
        hits.push({v,d:bd,at,side:sideOf(pts[bj],pts[bj+1],v.c)});
      }
      return hits;
    };
    let hits=scan(used); if(!hits.length) hits=scan(never);
    hits.sort((x,y)=>(y.v.s-x.v.s)||(x.d-y.d));
    return hits.slice(0,limit).sort((x,y)=>x.at-y.at);
  }

  /* ---- zone policy: what sequence of zones is legal? ---- */
  plan(o,d){
    const za=o.z, zb=d.z;
    if(!za||!zb||za===zb) return {ok:true, legs:[[o,d,null]], zones:[za||zb]};
    const fwd=this.portals.find(p=>p.frm===za&&p.to===zb);
    if(!fwd){
      const back=this.portals.find(p=>p.frm===zb&&p.to===za);
      const A=(ZONE[za]||{}).name||za, Z=(ZONE[zb]||{}).name||zb;
      return {ok:false, zones:[za,zb],
        reason: back
          ? `${A} and ${Z} are separated by a control point that only works in the other direction. Once you are through, there is no way back.`
          : `${A} and ${Z} are not connected for passengers. You would have to leave and re-enter the terminal.`};
    }
    let best=null,bd=Infinity;
    for(const i of fwd.cand){
      const c=this.pois[i]; if(c==null) continue;
      const r1=this.shortest(o.v,c.v), r2=this.shortest(c.v,d.v);
      if(!r1||!r2) continue;
      if(r1.m+r2.m<bd){bd=r1.m+r2.m; best=c;}
    }
    if(!best) return {ok:false, zones:[za,zb],
      reason:'The control point between these areas is not reachable in this map data.'};
    return {ok:true, legs:[[o,best,fwd],[best,d,null]], zones:[za,zb]};
  }
}
