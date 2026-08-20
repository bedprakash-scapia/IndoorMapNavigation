/* ---------- orientation: which way is the user already looking ---------- */

/* The bearing the route wants you to set off in. Taken from the first leg's
   first real displacement, so a cluster of near-identical nodes at the origin
   cannot produce a meaningless heading. */
Site.prototype.openingHeading = function(res){
  for(const leg of (res.path||[])){
    const pts=leg.map(s=>this.xy(s.n));
    for(let i=1;i<pts.length;i++) if(dist(pts[0],pts[i])>1.5) return bearing(pts[0],pts[i]);
  }
  return null;
};

/* Things you could plausibly be looking at from `o`: same level, same zone,
   scoreable as a landmark (a bench is not one) and close enough to see. */
Site.prototype.facingChoices = function(o, limit=10){
  const out=[];
  for(const v of (this.lm[o.l]||[])){
    if(v.n===o.n) continue;
    if(o.z && v.z && v.z!==o.z) continue;
    const d=dist(o.c, v.c);
    if(d>90) continue;
    out.push({v, d, b:bearing(o.c, v.c)});
  }
  out.sort((a,b)=>(b.v.s-a.v.s)||(a.d-b.d));
  return out.slice(0, limit);
};

/* Turn the gap between where you are looking and where you must walk into a
   first instruction. Thresholds mirror the narrator's own turn wording. */
function facingStep(o, facing, head){
  if(!facing || head==null) return null;
  const t=turnOf(bearing(o.c, facing.c), head), a=Math.abs(t);
  const turn=t>0?'right':'left', lands=t>0?'left':'right';
  if(a<25)   return {t:'face', dir:'ahead',  poi:facing,
    html:`Stand at ${B(o.n)}. ${B(facing.n)} is straight ahead — walk towards it.`};
  if(a>=150) return {t:'face', dir:'around', poi:facing,
    html:`Stand at ${B(o.n)} and turn all the way around, so ${B(facing.n)} is behind you.`};
  if(a>=65)  return {t:'face', dir:turn,     poi:facing,
    html:`Stand at ${B(o.n)} and turn ${turn}, so ${B(facing.n)} sits on your ${lands}.`};
  return {t:'face', dir:turn, poi:facing,
    html:`Stand at ${B(o.n)} and bear ${turn}, keeping ${B(facing.n)} just off your ${lands}.`};
}

/* ---------- category icons ---------- */
/* Filled glyphs, one per category, so a step that names a shop shows that
   shop's kind rather than a generic dot. */
const GLYPH={
  food:'<path d="M6.2 2.6h1.7v6.1h1.3V2.6h1.7v6.1h1.3V2.6h1.7v6.9c0 1.7-1.1 3.2-2.7 3.7v8.2H9.1v-8.2c-1.6-.5-2.9-2-2.9-3.7V2.6Zm11 0h1.5c.7 0 1.1.6 1.1 1.4v17.4h-2.1v-7.3h-2.1V6.1c0-2 .8-3.5 1.6-3.5Z"/>',
  retail:'<path fill-rule="evenodd" d="M8.6 7.9V6.8a3.4 3.4 0 0 1 6.8 0v1.1h3.3l1.1 13.3H4.2L5.3 7.9h3.3Zm1.9 0h3V6.8a1.5 1.5 0 0 0-3 0v1.1Z"/>',
  gate:'<path d="M21.4 15.6 13.7 11V4.7a1.7 1.7 0 0 0-3.4 0V11l-7.7 4.6v2.6l7.7-2.4v4.3l-2.6 1.8V23l4.3-1.1L16.3 23v-1.1l-2.6-1.8v-4.3l7.7 2.4v-2.6Z"/>',
  security:'<path d="M12 1.8 3.8 5.1v6.4c0 5.2 3.5 9.6 8.2 10.9 4.7-1.3 8.2-5.7 8.2-10.9V5.1L12 1.8Z"/>',
  baggage:'<path fill-rule="evenodd" d="M8.8 4.4A1.6 1.6 0 0 1 10.4 2.8h3.2a1.6 1.6 0 0 1 1.6 1.6v1.5h3.3a1.7 1.7 0 0 1 1.7 1.7v11.1a1.7 1.7 0 0 1-1.7 1.7H5.5a1.7 1.7 0 0 1-1.7-1.7V7.6a1.7 1.7 0 0 1 1.7-1.7h3.3V4.4Zm1.8 1.5h2.8V4.6h-2.8v1.3Z"/>',
  checkin:'<path fill-rule="evenodd" d="M2.8 6.4a1.6 1.6 0 0 1 1.6-1.6h15.2a1.6 1.6 0 0 1 1.6 1.6v3.1a2.6 2.6 0 0 0 0 5v3.1a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6v-3.1a2.6 2.6 0 0 0 0-5V6.4Zm12.3 1.4h1.7v8.4h-1.7V7.8Z"/>',
  money:'<path fill-rule="evenodd" d="M1.9 6.2h20.2v11.6H1.9V6.2Zm10.1 2.3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
  facility:'<path d="M12 2.2C8.9 6.4 5.7 9.7 5.7 13.3a6.3 6.3 0 0 0 12.6 0c0-3.6-3.2-6.9-6.3-11.1Z"/>',
  lounge:'<path d="M5.8 9V6.4a2.6 2.6 0 0 1 2.6-2.6h7.2a2.6 2.6 0 0 1 2.6 2.6V9a3.1 3.1 0 0 1 2.1 2.9v6.4h-2.1v2h-1.7v-2H7.5v2H5.8v-2H3.7v-6.4A3.1 3.1 0 0 1 5.8 9Z"/>',
  transport:'<path fill-rule="evenodd" d="M5.1 10.9 6.7 6.2A2.1 2.1 0 0 1 8.7 4.7h6.6a2.1 2.1 0 0 1 2 1.5l1.6 4.7H20a1 1 0 0 1 1 1v4.6a1 1 0 0 1-1 1h-1v1.5h-2.3v-1.5H7.3v1.5H5v-1.5H4a1 1 0 0 1-1-1v-4.6a1 1 0 0 1 1-1h1.1Zm2.2 0h9.4l-1.1-3.3H8.4l-1.1 3.3Z"/>',
  info:'<path fill-rule="evenodd" d="M12 1.9a10.1 10.1 0 1 0 0 20.2 10.1 10.1 0 0 0 0-20.2Zm-1.2 5.2H13v2.3h-2.2V7.1Zm0 3.8H13v6.2h-2.2v-6.2Z"/>',
  art:'<path fill-rule="evenodd" d="M2.8 3.8h18.4v16.4H2.8V3.8Zm2.5 13.9h13.4l-4.1-5.5-3 4-2.2-2.7-4.1 4.2Z"/>',
  place:'<path fill-rule="evenodd" d="M12 1.9a7.2 7.2 0 0 0-7.2 7.2c0 5.2 7.2 13 7.2 13s7.2-7.8 7.2-13A7.2 7.2 0 0 0 12 1.9Zm0 4.7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/>'
};

/* POI kind -> category. Anything unlisted falls through to `place`. */
const CAT={
  cafe:'food', restaurant:'food', fast_food:'food', bakery:'food', bar:'food',
  ice_cream:'food', pub:'food',
  clothes:'retail', shoes:'retail', jewelry:'retail', cosmetics:'retail',
  beauty:'retail', gift:'retail', fashion_accessories:'retail', duty_free:'retail',
  florist:'retail', mobile:'retail', newsagent:'retail', books:'retail',
  convinience_store:'retail', supermarket:'retail',
  gate:'gate',
  security:'security',
  baggage_claim:'baggage', baggage_service:'baggage', baggage_secure_wrap:'baggage',
  checkin:'checkin', airlines_counter:'checkin', airline_transfers:'checkin',
  atm:'money', bureau_de_change:'money',
  toilets:'facility', drinking_water:'facility', device_charging_station:'facility',
  pharmacy:'facility', place_of_worship:'facility', smoking_area:'facility',
  telephone:'facility', post_office:'facility',
  lounge:'lounge',
  taxi:'transport', car_rental:'transport',
  reception_desk:'info', travel_agency:'info',
  art:'art'
};
const catOf=p=>(p && CAT[p.k]) || 'place';

/* Maneuver glyphs, used when a step names no shop, and as the small corner
   badge when it does. */
const MOVE={
  ahead:'<path d="M12 3.4 12 20.6M12 3.4 5.9 9.5M12 3.4l6.1 6.1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  left:'<path d="M17.2 20.6v-8.4a3.6 3.6 0 0 0-3.6-3.6H6.8M6.8 8.6l4.1-4.1M6.8 8.6l4.1 4.1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  right:'<path d="M6.8 20.6v-8.4a3.6 3.6 0 0 1 3.6-3.6h6.8M17.2 8.6l-4.1-4.1M17.2 8.6l-4.1 4.1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  around:'<path d="M8.4 20.4V9.6a4.2 4.2 0 0 1 8.4 0v10.8M16.8 20.4l-3.1-3.4M16.8 20.4l3.1-3.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  level:'<path d="M8 20.4V4.6M8 4.6 4.6 8M8 4.6 11.4 8M16 3.6v15.8m0 0 3.4-3.4M16 19.4l-3.4-3.4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  start:'<circle cx="12" cy="12" r="4.6" fill="currentColor"/><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2"/>',
  end:'<path fill-rule="evenodd" d="M12 1.9a7.2 7.2 0 0 0-7.2 7.2c0 5.2 7.2 13 7.2 13s7.2-7.8 7.2-13A7.2 7.2 0 0 0 12 1.9Zm0 4.7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" fill="currentColor"/>',
  portal:'<path d="M4.2 20.4V3.6h8.6v16.8zM12.8 12h7.2m0 0-3.2-3.2m3.2 3.2-3.2 3.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
};
