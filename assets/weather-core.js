window.WX = (function(){
  const API='https://api.weather.gov',LOC_KEY='weather-location',POINT_CACHE_KEY='weather-point-cache',POINT_TTL=6*3600000,DEFAULT_LOC={lat:44.0136,lon:-92.4757,label:'Rochester, Minnesota',source:'default'};
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let currentLoc=null;

  function getSavedLocation(){try{return JSON.parse(localStorage.getItem(LOC_KEY))}catch{return null}}
  function saveLocation(loc){currentLoc=loc;try{localStorage.setItem(LOC_KEY,JSON.stringify(loc))}catch{}}
  function pointCacheKey(lat,lon){return `${lat.toFixed(2)},${lon.toFixed(2)}`}
  function getCachedPoint(lat,lon){try{const all=JSON.parse(localStorage.getItem(POINT_CACHE_KEY)||'{}');const entry=all[pointCacheKey(lat,lon)];if(entry&&Date.now()-entry.ts<POINT_TTL)return entry.point}catch{}return null}
  function setCachedPoint(lat,lon,point){try{const all=JSON.parse(localStorage.getItem(POINT_CACHE_KEY)||'{}');all[pointCacheKey(lat,lon)]={point,ts:Date.now()};const keys=Object.keys(all);if(keys.length>5){keys.sort((a,b)=>all[a].ts-all[b].ts);delete all[keys[0]]}localStorage.setItem(POINT_CACHE_KEY,JSON.stringify(all))}catch{}}
  function geolocate(opts={}){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Geolocation unsupported'));navigator.geolocation.getCurrentPosition(pos=>resolve({lat:+pos.coords.latitude.toFixed(4),lon:+pos.coords.longitude.toFixed(4)}),reject,{enableHighAccuracy:false,timeout:5000,maximumAge:600000,...opts})})}
  async function geocodeSearch(query){const results=await json(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`);if(!results.length)throw new Error('Location not found.');return {lat:+(+results[0].lat).toFixed(4),lon:+(+results[0].lon).toFixed(4)}}
  const US_STATE_ABBR={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC','Puerto Rico':'PR',Guam:'GU','American Samoa':'AS','U.S. Virgin Islands':'VI','Northern Mariana Islands':'MP'};
  function normalizedLabel(result){
    const a=result.address||{};
    const city=a.city||a.town||a.village||a.hamlet||a.municipality||a.suburb||a.county;
    const state=US_STATE_ABBR[a.state]||a.state;
    return city&&state?`${city}, ${state}`:result.display_name;
  }
  function refreshGeoInBackground(saved){geolocate({maximumAge:0}).then(pos=>{const sameSpot=saved.lat===pos.lat&&saved.lon===pos.lon;saveLocation({...pos,label:sameSpot?saved.label:null,source:'geo'})}).catch(()=>{})}
  async function resolveLocation(){
    const saved=getSavedLocation();
    if(saved){
      currentLoc=saved;
      if(saved.source==='geo')refreshGeoInBackground(saved);
      return saved;
    }
    try{const pos=await geolocate();const loc={...pos,label:null,source:'geo'};saveLocation(loc);return loc}
    catch{const loc={...DEFAULT_LOC};currentLoc=loc;return loc}
  }
  async function json(url){let last;for(let i=0;i<2;i++){try{const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/geo+json, application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`weather.gov returned ${r.status}`);return await r.json()}catch(e){last=e}}throw last}

  async function resolvePoint(loc){
    let point=getCachedPoint(loc.lat,loc.lon);
    if(!point){point=await json(`${API}/points/${loc.lat},${loc.lon}`);setCachedPoint(loc.lat,loc.lon,point)}
    const rel=point.properties.relativeLocation?.properties;
    const label=rel?`${rel.city}, ${rel.state}`:loc.label||'Selected location';
    if(loc.label!==label)saveLocation({...loc,label});
    const tz=point.properties.timeZone||'America/Chicago';
    const officeId=(point.properties.forecastOffice||'').split('/').pop();
    const countyId=(point.properties.county||'').split('/').pop();
    const zoneId=(point.properties.forecastZone||'').split('/').pop();
    return {point,label,tz,officeId,countyId,zoneId};
  }

  function emoji(text){const t=String(text).toLowerCase();return /thunder/.test(t)?'⛈️':/snow|blizzard/.test(t)?'🌨️':/ice|freezing|sleet/.test(t)?'🧊':/rain|shower|drizzle/.test(t)?'🌧️':/fog|mist/.test(t)?'🌫️':/partly|mostly sunny/.test(t)?'🌤️':/cloud|overcast/.test(t)?'☁️':/sun|clear/.test(t)?'☀️':'🌡️'}
  const local=(t,tz,options={})=>t?new Date(t).toLocaleString('en-US',{timeZone:tz||'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',...options}):'Not provided';
  function maxWind(s){const n=(String(s).match(/\d+/g)||[]).map(Number);return n.length?Math.max(...n):null}
  function gustFrom(text){const m=String(text).match(/gusts?(?: as high as| up to| near| to)?\s*(\d+)\s*mph/i);return m?+m[1]:null}
  function durationMs(iso){const m=iso.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);return m?((+m[1]||0)*864e5+(+m[2]||0)*36e5+(+m[3]||0)*6e4):36e5}
  function gridValues(field,times,convert=v=>v){if(!field?.values)return times.map(()=>null);return times.map(t=>{const ms=t.getTime();for(const row of field.values){const [start,dur='PT1H']=row.validTime.split('/');const a=new Date(start).getTime();if(ms>=a&&ms<a+durationMs(dur))return row.value==null?null:convert(row.value)}return null})}
  const kphToMph=v=>Math.round(v*.621371), cToF=v=>Math.round(v*9/5+32);
  async function product(type,officeId){try{const list=await json(`${API}/products/types/${type}/locations/${officeId}`);const item=(list['@graph']||[])[0];if(!item?.id)return null;return await json(item.id.startsWith('http')?item.id:`${API}/products/${item.id}`)}catch{return null}}
  // Great-circle distance in miles between two [lon,lat] points.
  function milesBetween([lon1,lat1],[lon2,lat2]){
    const R=3958.8,toRad=d=>d*Math.PI/180;
    const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  async function currentObservation(point){
    const stations=await json(point.properties.observationStations);
    const origin=point.geometry?.coordinates;
    // NWS's own station list is ordered nearest-first, but "nearest" can
    // still be tens of miles away in sparsely-instrumented areas — cap how
    // far the fallback is willing to reach so a distant station's reading
    // never gets shown as if it were local.
    const MAX_MILES=50;
    let candidates=(stations.features||[]).slice(0,8);
    if(origin){
      candidates=candidates.filter(f=>!f.geometry?.coordinates||milesBetween(origin,f.geometry.coordinates)<=MAX_MILES);
    }
    const ids=candidates.slice(0,5).map(f=>f.id);
    if(!ids.length)throw new Error('No observation station within range.');
    // The nearest station is sometimes offline or stale (unmaintained gauge,
    // outage, etc.) — try the next-closest ones in order rather than giving
    // up on the whole location after one bad station.
    let last=new Error('Current conditions unavailable.');
    for(const station of ids){
      try{
        const result=await json(`${station}/observations/latest`);
        const observation=result.properties,age=Date.now()-Date.parse(observation?.timestamp);
        if(!Number.isFinite(age)||age< -300000||age>2*3600000||!observation.textDescription?.trim())throw new Error('Current conditions unavailable.');
        return {observation,confirmedAt:new Date()};
      }catch(e){last=e}
    }
    throw last;
  }
  function currentHeadline(observation){
    const condition=observation.textDescription.trim();
    const value=observation.temperature?.value;
    const unit=observation.temperature?.unitCode;
    const temperature=value==null?null:unit?.endsWith('degC')?cToF(value):unit?.endsWith('degF')?Math.round(value):null;
    return `${condition}${temperature==null?'':` · ${temperature}°F`}`;
  }
  function alertLine(a,tz){const p=a.properties;return `<div class="alert"><strong>${esc(p.event)}</strong><p>${esc(p.areaDesc)}</p><p>${esc(local(p.onset||p.effective,tz))}–${esc(local(p.ends||p.expires,tz))}</p><p>${esc((p.instruction||p.description||'See NWS alert for instructions.').replace(/\s+/g,' '))}</p><a href="${esc(p['@id']||a.id)}" target="_blank" rel="noreferrer">Full NWS alert</a></div>`}
  function dayKey(tz,date){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date))}
  function startOfDay(tz){
    // Shift "now" onto the wall-clock time of tz (interpreted as if it were
    // the machine's own local time), zero it to midnight, then correct back
    // by the gap between that shift and the real machine-local time.
    const now=new Date();
    const shifted=new Date(now.toLocaleString('en-US',{timeZone:tz}));
    const diff=now.getTime()-shifted.getTime();
    shifted.setHours(0,0,0,0);
    return new Date(shifted.getTime()+diff);
  }
  function hourLabel(date,tz){
    const h=+new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',hour12:false}).format(new Date(date))%24;
    const h12=h%12===0?12:h%12;
    return `${h12}${h<12?'a':'p'}`;
  }
  // Named dayparts (Evening/Overnight/Morning/Afternoon), the way Apple/Carrot
  // Weather group an hourly timeline, instead of raw clock-hour ticks.
  function dayPartLabel(date,tz){
    const h=+new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',hour12:false}).format(new Date(date))%24;
    if(h>=18)return 'Evening';
    if(h<6)return 'Overnight';
    if(h<12)return 'Morning';
    return 'Afternoon';
  }
  function findTodayPeriods(allPeriods,tz){
    const todayKey=dayKey(tz,new Date());
    return {
      day: allPeriods.find(p=>p.isDaytime&&dayKey(tz,p.startTime)===todayKey)||null,
      night: allPeriods.find(p=>!p.isDaytime&&dayKey(tz,p.startTime)===todayKey)||null
    };
  }
  // NWS's forecastGridData has no UV index field at all (the old EPA UV
  // Index API it once pointed to was retired), so this was previously
  // always null for everyone regardless of location. Estimated instead from
  // solar noon zenith angle for the date/latitude — the same clear-sky
  // geometry real UV forecasts start from before applying ozone/cloud
  // corrections we have no data source for — rather than a metric that can
  // never populate.
  function uvForDate(dateKey,lat){
    if(lat==null)return null;
    const[y,m,d]=dateKey.split('-').map(Number);
    const rad=Math.PI/180,start=Date.UTC(y,0,1),dayOfYear=Math.floor((Date.UTC(y,m-1,d)-start)/86400000)+1;
    const declination=23.44*Math.sin(rad*(360/365)*(dayOfYear-81));
    const zenith=Math.abs(lat-declination);
    if(zenith>=90)return 0;
    return Math.max(0,Math.round(12.5*Math.pow(Math.cos(zenith*rad),2.42)));
  }
  function humidityForDate(grid,dateKey,tz){const values=grid.properties?.relativeHumidity?.values||[];const vals=values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey).map(r=>r.value).filter(v=>v!=null);if(!vals.length)return null;return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)}
  function gustForDate(grid,dateKey,tz){const field=grid.properties?.windGust;const values=field?.values||[];const kph=field?.uom?.includes('km_h');const vals=values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey).map(r=>r.value).filter(v=>v!=null);if(!vals.length)return null;const max=Math.max(...vals);return Math.round(kph?max*.621371:max)}
  // NWS's gridpoint maxTemperature/minTemperature cover the full calendar day
  // regardless of the current time, unlike the text forecast's day/night
  // periods (which disappear once that period ends). Standard practice —
  // matching NWS's own text-forecast generator and apps like Apple Weather —
  // is to fall back to this structured data so a day's high/low still shows
  // after its period has passed, rather than going blank.
  function tempForDate(grid,field,dateKey,tz){const values=grid.properties?.[field]?.values||[];for(const row of values){if(dayKey(tz,row.validTime.split('/')[0])===dateKey&&row.value!=null)return cToF(row.value)}return null}
  const maxTempForDate=(grid,dateKey,tz)=>tempForDate(grid,'maxTemperature',dateKey,tz);
  const minTempForDate=(grid,dateKey,tz)=>tempForDate(grid,'minTemperature',dateKey,tz);
  function dayRows(allPeriods,grid,tz,lat){
    // Group by calendar date (in the location's timezone) rather than walking
    // day/night pairs positionally, so today's row is always complete even
    // once its daytime period's endTime has passed, and exactly 7 calendar
    // days are returned whenever NWS provides that much data.
    const order=[],byKey={};
    allPeriods.forEach(p=>{
      const key=dayKey(tz,p.startTime);
      if(!byKey[key]){byKey[key]={date:new Date(p.startTime),day:null,night:null};order.push(key)}
      if(p.isDaytime)byKey[key].day=byKey[key].day||p;else byKey[key].night=byKey[key].night||p;
    });
    const todayKey=dayKey(tz,new Date());
    const startIdx=Math.max(0,order.indexOf(todayKey));
    return order.slice(startIdx,startIdx+7).map(key=>({...byKey[key],uv:uvForDate(key,lat),humidity:humidityForDate(grid,key,tz),gust:gustForDate(grid,key,tz),hi:maxTempForDate(grid,key,tz),lo:minTempForDate(grid,key,tz)}));
  }
  function windAvg(windSpeed){
    const nums=(String(windSpeed).match(/\d+/g)||[]).map(Number);
    if(!nums.length)return null;
    return Math.round(nums.reduce((a,b)=>a+b,0)/nums.length);
  }
  function dayMetrics(d,n,uv,humidity,gridGust,gridHi,gridLo){
    const b=d||n;
    const gusts=[d,n].filter(Boolean).map(p=>gustFrom(p.detailedForecast)).filter(v=>v!=null);
    const textGust=gusts.length?Math.max(...gusts):null;
    const gust=gridGust??textGust;
    const pop=d?.probabilityOfPrecipitation?.value;
    const wind=windAvg(b.windSpeed);
    // Once today's daytime period has already passed, NWS stops returning it
    // entirely (its periods only run forward from now). Fall back to the
    // gridpoint's maxTemperature/minTemperature — which cover the full
    // calendar day regardless of the current time — so the high still shows
    // after its period has passed, matching how NWS's own forecast text and
    // apps like Apple Weather handle it, instead of going blank.
    const hi=d?.temperature??gridHi;
    const lo=n?.temperature??gridLo;
    const hiLo=hi!=null&&lo!=null?['H',`${hi}° L: ${lo}°`]:hi!=null?['H',`${hi}°`]:lo!=null?['L',`${lo}°`]:null;
    return [
      hiLo,
      pop==null?null:['Rain %',`${pop}%`],
      humidity==null?null:['Humidity',`${humidity}%`],
      ['Wind',wind==null?esc(b.windSpeed):`${wind} mph`],
      gust==null?null:['Gusts',`${gust} mph`],
      uv==null?null:['Max UV',uv]
    ].filter(Boolean);
  }
  function metricsHTML(pairs){return pairs.map(([k,v])=>`<span class="metric"><b>${esc(k)}:</b> ${v}</span>`).join('')}
  // Sunrise/sunset equation (Wikipedia "Sunrise equation" / NOAA solar
  // calculator), accurate to within a minute or two — no API, no key,
  // computed entirely from lat/lon/date the way Apple Weather's astro data
  // is, just without needing a bundled library like SunCalc.
  function sunTimes(date,lat,lon){
    const rad=Math.PI/180;
    const toJulian=d=>d.getTime()/86400000+2440587.5;
    const fromJulian=j=>new Date((j-2440587.5)*86400000);
    const J2000=2451545.0;
    const n=Math.ceil(toJulian(date)-J2000+0.0008);
    const meanSolarNoon=n-lon/360;
    const M=(357.5291+0.98560028*meanSolarNoon)%360;
    const C=1.9148*Math.sin(M*rad)+0.02*Math.sin(2*M*rad)+0.0003*Math.sin(3*M*rad);
    const lambda=(M+C+180+102.9372)%360;
    const Jtransit=J2000+meanSolarNoon+0.0053*Math.sin(M*rad)-0.0069*Math.sin(2*lambda*rad);
    const sinDelta=Math.sin(lambda*rad)*Math.sin(23.44*rad);
    const cosH=(Math.sin(-0.83*rad)-Math.sin(lat*rad)*sinDelta)/(Math.cos(lat*rad)*Math.cos(Math.asin(sinDelta)));
    if(cosH>1||cosH<-1)return{sunrise:null,sunset:null}; // polar night / midnight sun
    const H=Math.acos(cosH)/rad;
    return{sunrise:fromJulian(Jtransit-H/360),sunset:fromJulian(Jtransit+H/360)};
  }
  function sunMetrics(date,lat,lon,tz){
    if(lat==null||lon==null||!date)return[];
    const{sunrise,sunset}=sunTimes(date,lat,lon);
    const fmt=d=>new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(d);
    return[sunrise?['Sunrise',fmt(sunrise)]:null,sunset?['Sunset',fmt(sunset)]:null].filter(Boolean);
  }
  // Punchy one-line summaries replacing the old Today/Tonight (or Day/Night)
  // bullet breakdown. todayBrief leads with the live observation since "now"
  // is known; futureBrief leads with the H/L range since a future day has no
  // "current" reading yet.
  function todayBrief(current,d,n){
    const now=current||(d?`${d.shortForecast} with a high near ${d.temperature}°`:'Conditions unavailable');
    const later=n?`Becoming ${n.shortForecast.toLowerCase()} tonight with a low near ${n.temperature}°.`:'';
    return {now:`${now}.`,later};
  }
  function futureBrief(d,n){
    // "the evening", not "tonight" — these cards are never today, and
    // "tonight" specifically reads as "later today" to a reader.
    const hi=d?`${d.shortForecast} with a high near ${d.temperature}°`:null;
    const lo=n?`${hi?`becoming ${n.shortForecast.toLowerCase()} in the evening`:n.shortForecast} with a low near ${n.temperature}°`:null;
    if(hi&&lo)return `${hi}, ${lo}.`;
    return `${hi||lo||'Forecast unavailable'}.`;
  }
  function renderFutureCardHTML(title,d,n,metrics){
    return `<article class="brief"><h3>${esc(title)}</h3><hr><p class="condition">${esc(futureBrief(d,n))}</p><div class="metrics">${metrics}</div></article>`;
  }
  function renderDaysHTML(rows,tz,loc){
    return rows.map(r=>{
      const d=r.day,n=r.night,b=d||n;
      const title=r.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:tz});
      const metrics=metricsHTML([...dayMetrics(d,n,r.uv,r.humidity,r.gust,r.hi,r.lo),...sunMetrics(r.date,loc?.lat,loc?.lon,tz)]);
      return `<article class="day"><div class="day-title"><span aria-hidden="true">${emoji(b.shortForecast)}</span> ${esc(title)}</div><hr><p class="condition">${esc(futureBrief(d,n))}</p><div class="metrics">${metrics}</div></article>`;
    }).join('');
  }
  // Shared by the Today page and the 7-day page's first (today) card so the
  // two never drift apart: same brief statement, same metrics, same NWS
  // Alerts section, fetched and rendered by this one function.
  async function loadTodayCard(container,title,loc,point,officeId,todayPeriods,grid,tz){
    const todayKey=dayKey(tz,new Date());
    const metrics=metricsHTML([...dayMetrics(todayPeriods.day,todayPeriods.night,uvForDate(todayKey,loc.lat),humidityForDate(grid,todayKey,tz),gustForDate(grid,todayKey,tz),maxTempForDate(grid,todayKey,tz),minTempForDate(grid,todayKey,tz)),...sunMetrics(new Date(),loc.lat,loc.lon,tz)]);
    const current=await currentObservation(point).catch(()=>null);
    const currentText=current?currentHeadline(current.observation):null;
    const brief=todayBrief(currentText,todayPeriods.day,todayPeriods.night);
    const alertsRes=await json(`${API}/alerts/active?point=${loc.lat},${loc.lon}`).catch(()=>null);
    const active=alertsRes?.features||[];
    const laterHTML=brief.later?`<p class="condition">${esc(brief.later)}</p>`:'';
    // Only show the NWS Alerts block when there's a genuine active alert —
    // otherwise this card keeps the exact same shape (brief + metrics, no
    // trailing section) as every other day's card instead of always
    // reserving space for a "No active NWS alerts." line.
    const alertsSectionHTML=active.length?`<hr><h3>NWS Alerts</h3><div id="alerts">${active.map(a=>alertLine(a,tz)).join('')}</div>`:'';
    container.innerHTML=`<article class="brief"><h3>${esc(title)}</h3><hr><p class="now-line">${esc(brief.now)}</p>${laterHTML}<div class="metrics">${metrics}</div>${alertsSectionHTML}</article>`;
    if(!active.length||!officeId)return;
    const hazardText=[todayPeriods.day?.detailedForecast,todayPeriods.night?.detailedForecast].filter(Boolean).join(' ');
    const needsHazard=/thunder|snow|ice|freezing|fog|heavy rain|blizzard/i.test(hazardText)||(gustFrom(hazardText)||0)>20;
    if(needsHazard){
      const [hwo,afd]=await Promise.all([product('HWO',officeId),product('AFD',officeId)]);
      const guidance=[hwo?.productText,afd?.productText].filter(Boolean).join(' ');
      let extra='';
      if(/severe|tornado|hail|damaging|blizzard|flood/i.test(guidance))extra+='<p class="note">Regional NWS hazard guidance indicates elevated risk nearby. Regional threats may not apply to your exact location; only issued local alerts are listed above.</p>';
      if(!hwo||!afd)extra+='<p class="note">Some regional hazard guidance could not be refreshed.</p>';
      if(extra){const slot=container.querySelector('#alerts');if(slot)slot.innerHTML+=extra}
    }
  }

  const LOCATE_ICON='<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 2.3 4.4 20.2c-.18.42.27.85.68.66L12 17.8l6.92 3.06c.41.19.86-.24.68-.66L12 2.3z" fill="currentColor" transform="rotate(45 12 12)"/></svg>';
  const SEARCH_ICON='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const HAMBURGER_ICON='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></g></svg>';
  const SUN_ICON='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="4.3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="19.8" y1="4.2" x2="18" y2="6"/><line x1="6" y1="18" x2="4.2" y2="19.8"/></g></svg>';
  const MOON_ICON='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-13 7 7 0 0 0 9 13z" fill="currentColor"/></svg>';
  const THEME_KEY='weather-theme';
  // Stored preference is 'light' | 'dark' | 'system'; 'dark' is the fallback
  // when nothing is stored, matching the site's existing default so nobody's
  // appearance changes just because this option now exists. Only an explicit
  // light/dark choice sets the data-theme attribute — 'system' clears it and
  // leaves :root[data-theme] unset, which site.css resolves via a
  // prefers-color-scheme media query instead.
  function getThemeChoice(){try{const v=localStorage.getItem(THEME_KEY);return v==='light'||v==='system'?v:'dark'}catch{return 'dark'}}
  function getTheme(){
    const attr=document.documentElement.getAttribute('data-theme');
    if(attr==='light'||attr==='dark')return attr;
    try{return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch{return 'dark'}
  }
  function setTheme(choice){
    if(choice==='light'||choice==='dark')document.documentElement.setAttribute('data-theme',choice);
    else document.documentElement.removeAttribute('data-theme');
    try{localStorage.setItem(THEME_KEY,choice)}catch{}
    document.dispatchEvent(new CustomEvent('themechange',{detail:{theme:getTheme()}}));
  }
  // Live-sync an open tab when the OS theme changes and the site is set to
  // follow it, so e.g. the radar basemap recolors without a reload.
  try{
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{
      if(getThemeChoice()==='system')document.dispatchEvent(new CustomEvent('themechange',{detail:{theme:getTheme()}}));
    });
  }catch{}
  function mountHeader(active,onLocationChange){
    const header=el('site-header');
    header.innerHTML=`
      <div class="icon-row">
        <button class="icon-btn ghost hamburger-btn" id="menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="nav-drawer" aria-label="Menu">${HAMBURGER_ICON}</button>
        <button class="icon-btn ghost" id="theme-btn" type="button" aria-label="Switch theme"></button>
      </div>
      <form id="location-form" class="location-form" role="search">
        <div class="search-field">
          <button class="icon-btn" id="locate-btn" type="button" aria-label="Use current location">${LOCATE_ICON}</button>
          <input id="location-input" list="location-suggestions" type="text" inputmode="search" autocomplete="off" placeholder="City, state or ZIP" aria-label="Search for a location">
          <datalist id="location-suggestions"></datalist>
          <button class="icon-btn" type="submit" aria-label="Search location">${SEARCH_ICON}</button>
        </div>
      </form>
      <nav class="tabs" aria-label="Pages">
        <a href="/" class="tab${active==='today'?' active':''}">Today</a>
        <a href="/forecast.html" class="tab${active==='forecast'?' active':''}">7-Day</a>
        <a href="/radar.html" class="tab${active==='radar'?' active':''}">Radar</a>
      </nav>`;
    // Appended directly to <body> because the header's backdrop-filter creates
    // a containing block that would confine fixed navigation to the header.
    if(!el('nav-drawer')){
      document.body.insertAdjacentHTML('beforeend',`
        <div class="nav-scrim" id="nav-scrim" aria-hidden="true"></div>
        <nav class="nav-drawer" id="nav-drawer" aria-label="Site menu" aria-hidden="true">
          <a href="/settings.html" data-subpage="settings">Settings</a>
          <a href="/credits.html" class="nav-drawer-bottom" data-subpage="credits">Credits</a>
        </nav>
        <dialog class="nav-subpage" id="nav-subpage" aria-labelledby="nav-subpage-title">
          <div class="nav-subpage-shell">
            <div class="nav-subpage-head">
              <button class="nav-subpage-close" id="nav-subpage-close" type="button" aria-label="Close secondary page">‹ Weather</button>
              <h1 class="nav-subpage-title" id="nav-subpage-title"></h1>
            </div>
            <div class="nav-subpage-content" id="nav-subpage-content"></div>
          </div>
        </dialog>`);
    }
    function paintThemeBtn(){
      const dark=getTheme()==='dark';
      el('theme-btn').innerHTML=dark?SUN_ICON:MOON_ICON;
      el('theme-btn').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    }
    paintThemeBtn();
    el('theme-btn').addEventListener('click',()=>{setTheme(getTheme()==='dark'?'light':'dark');paintThemeBtn()});
    let drawerOpen=false;
    function setDrawer(open,restoreFocus=true){
      drawerOpen=open;
      if(open){
        const top=`${el('menu-btn').getBoundingClientRect().bottom}px`;
        el('nav-drawer').style.top=top;
        el('nav-scrim').style.top=top;
      }
      el('nav-drawer').classList.toggle('open',open);
      el('nav-scrim').classList.toggle('open',open);
      el('nav-drawer').setAttribute('aria-hidden',String(!open));
      el('menu-btn').setAttribute('aria-expanded',String(open));
      if(open)el('nav-drawer').querySelector('a')?.focus();else if(restoreFocus)el('menu-btn').focus();
    }
    el('menu-btn').addEventListener('click',()=>setDrawer(!drawerOpen));
    el('nav-scrim').addEventListener('click',()=>setDrawer(false));
    const subpage=el('nav-subpage'),subpageContent=el('nav-subpage-content');
    let subpageTrigger=null,subpageCloseTimer=null;
    const subpageCache=new Map();
    function paintSubpageTheme(){subpageContent.querySelectorAll('[data-choice]').forEach(b=>b.classList.toggle('active',b.dataset.choice===getThemeChoice()))}
    async function openSubpage(name,href){
      clearTimeout(subpageCloseTimer);subpageTrigger=el('menu-btn');setDrawer(false,false);
      el('nav-subpage-title').textContent=name[0].toUpperCase()+name.slice(1);subpageContent.innerHTML='<div class="loading" role="status">Loading…</div>';
      subpage.showModal();document.body.classList.add('subpage-open');requestAnimationFrame(()=>subpage.classList.add('open'));el('nav-subpage-close').focus();
      try{
        let content=subpageCache.get(name);
        if(!content){
          const response=await fetch(href);if(!response.ok)throw new Error('Secondary page unavailable');
          const page=new DOMParser().parseFromString(await response.text(),'text/html');
          content=page.querySelector('.credit-list')?.outerHTML;if(!content)throw new Error('Secondary page unavailable');
          subpageCache.set(name,content);
        }
        if(!subpage.open)return;
        subpageContent.innerHTML=content;
        if(name==='settings'){
          paintSubpageTheme();
          subpageContent.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{setTheme(b.dataset.choice);paintThemeBtn();paintSubpageTheme()}));
        }
      }catch{
        if(!subpage.open)return;
        subpage.close();document.body.classList.remove('subpage-open');location.href=href;
      }
    }
    function closeSubpage(){
      if(!subpage.open)return;
      subpage.classList.remove('open');document.body.classList.remove('subpage-open');
      const finish=()=>{if(subpage.open)subpage.close();subpageTrigger?.focus();subpageTrigger=null};
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();else subpageCloseTimer=setTimeout(finish,200);
    }
    el('nav-drawer').querySelectorAll('[data-subpage]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();openSubpage(a.dataset.subpage,a.href)}));
    el('nav-subpage-close').addEventListener('click',closeSubpage);
    subpage.addEventListener('cancel',e=>{e.preventDefault();closeSubpage()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawerOpen)setDrawer(false)});
    let suggestionMap=new Map(),suggestTimer=null;
    function setKicker(text){const k=el('kicker');if(k){k.textContent=text;k.style.display=text?'':'none'}}
    function pick(pos,query){
      saveLocation({...pos,label:null,source:'search',query});
      el('location-input').value='';el('location-suggestions').innerHTML='';suggestionMap.clear();
      el('location-input').blur();
      onLocationChange();
    }
    el('location-input').addEventListener('input',()=>{
      clearTimeout(suggestTimer);
      const q=el('location-input').value.trim();
      if(suggestionMap.has(q)){setKicker('Loading…');pick(suggestionMap.get(q),q);return}
      if(q.length<3){suggestionMap.clear();el('location-suggestions').innerHTML='';return}
      suggestTimer=setTimeout(async()=>{
        try{
          const results=await json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(q)}`);
          suggestionMap=new Map();
          results.forEach(r=>{const label=normalizedLabel(r);if(!suggestionMap.has(label))suggestionMap.set(label,{lat:+(+r.lat).toFixed(4),lon:+(+r.lon).toFixed(4)})});
          el('location-suggestions').innerHTML=[...suggestionMap.keys()].map(name=>`<option value="${esc(name)}"></option>`).join('');
        }catch{}
      },350);
    });
    el('location-form').addEventListener('submit',async e=>{
      e.preventDefault();
      const q=el('location-input').value.trim();
      if(!q)return;
      setKicker('Searching…');
      try{pick(suggestionMap.get(q)||await geocodeSearch(q),q)}
      catch(err){setKicker(err.message||'Location search failed')}
    });
    el('locate-btn').addEventListener('click',async()=>{
      setKicker('Locating…');
      try{const pos=await geolocate();saveLocation({...pos,label:null,source:'geo'});onLocationChange()}
      catch{setKicker('Location access denied or unavailable')}
    });
    return {setKicker};
  }

  function mountFooterNav(active){
    const footer=el('site-footer-nav');
    if(!footer)return;
    footer.innerHTML=`
      <nav class="tabs foot-tabs" aria-label="Pages">
        <a href="/" class="tab${active==='today'?' active':''}">Today</a>
        <a href="/forecast.html" class="tab${active==='forecast'?' active':''}">7-Day</a>
        <a href="/radar.html" class="tab${active==='radar'?' active':''}">Radar</a>
      </nav>`;
  }

  // Turns any light MapLibre/OpenMapTiles-schema style into a dark one by
  // inverting the lightness of every paint color it finds, recursively (so
  // colors nested inside zoom-interpolated expressions get caught too), while
  // leaving hue and saturation alone. This lets a map basemap use OpenFreeMap's
  // actively-maintained "liberty" style/tiles even in dark mode, instead of
  // depending on their separate, unmaintained "dark" style.
  function hexToRgb(hex){
    hex=hex.replace('#','');
    if(hex.length===3||hex.length===4)hex=hex.split('').map(c=>c+c).join('');
    const num=parseInt(hex.slice(0,6),16);
    return [(num>>16)&255,(num>>8)&255,num&255];
  }
  function rgbToHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b);
    let h=0,s=0;const l=(max+min)/2;
    if(max!==min){
      const d=max-min;
      s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r)h=(g-b)/d+(g<b?6:0);
      else if(max===g)h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h/=6;
    }
    return [h*360,s*100,l*100];
  }
  function hslToRgb(h,s,l){
    h/=360;s/=100;l/=100;
    let r,g,b;
    if(s===0){r=g=b=l}
    else{
      const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};
      const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
      r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);
    }
    return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];
  }
  const rgbToHex=(r,g,b)=>'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
  function colorToHex(v){
    if(v[0]==='#')return v.length>7?v.slice(0,7):v;
    let m=v.match(/rgba?\(([^)]+)\)/i);
    if(m){const p=m[1].split(',').map(parseFloat);return rgbToHex(p[0],p[1],p[2])}
    m=v.match(/hsla?\(([^)]+)\)/i);
    if(m){const p=m[1].split(',').map(parseFloat);return rgbToHex(...hslToRgb(p[0],p[1],p[2]))}
    return null;
  }
  function invertLightness(hex,minL=6,maxL=92){
    try{
      const [r,g,b]=hexToRgb(hex);
      const [h,s,l]=rgbToHsl(r,g,b);
      const newL=Math.max(minL,Math.min(maxL,100-l));
      return rgbToHex(...hslToRgb(h,s,newL));
    }catch{return hex}
  }
  function isColorString(v){return typeof v==='string'&&(/^#[0-9a-f]{3,8}$/i.test(v)||/^rgba?\(/i.test(v)||/^hsla?\(/i.test(v))}
  function darkenColorValue(value){
    if(Array.isArray(value))return value.map(darkenColorValue);
    if(isColorString(value)){const hex=colorToHex(value);return hex?invertLightness(hex):value}
    return value;
  }
  function recolorStyleDark(style){
    const clone=JSON.parse(JSON.stringify(style));
    for(const layer of clone.layers||[]){
      if(!layer.paint)continue;
      for(const key of Object.keys(layer.paint)){
        if(/color$/i.test(key))layer.paint[key]=darkenColorValue(layer.paint[key]);
      }
    }
    // Force a true black background regardless of the computed inversion, to
    // match the site's own dark palette exactly rather than an inverted tint.
    const bg=(clone.layers||[]).find(l=>l.type==='background');
    if(bg){bg.paint=bg.paint||{};bg.paint['background-color']='#000'}
    return clone;
  }

  // Radar apps (RadarScope, Apple Weather) always show reflectivity against a
  // near-black, roads-only basemap regardless of the app's own light/dark
  // setting — busy terrain/landuse/building/POI layers compete with the
  // radar colors instead of receding behind them. Rather than recolor the
  // full "liberty" style (which keeps every layer, just inverted), this
  // strips it down to only what a radar basemap needs, filtering by the
  // vector tiles' OpenMapTiles source-layer names (stable across whichever
  // cartographic style OpenFreeMap serves them through, unlike its own
  // layer ids). Everything else — landcover, landuse, parks, buildings,
  // POIs, minor roads, small-place labels — is dropped outright.
  function minimalDarkRadarStyle(style){
    const clone=JSON.parse(JSON.stringify(style));
    const KEEP_SOURCE_LAYERS=new Set(['water','waterway','boundary','transportation','transportation_name','place']);
    const MAJOR_ROAD=/motorway|trunk|primary/i;
    const MINOR_ROAD=/path|footway|steps|cycleway|track|service|pedestrian|rail/i;
    const MINOR_PLACE=/village|hamlet|suburb|neighbourhood|neighborhood|quarter|isolated_dwelling|housenumber/i;
    clone.layers=(clone.layers||[]).filter(l=>{
      if(l.type==='background')return true;
      const sl=l['source-layer'];
      if(!sl||!KEEP_SOURCE_LAYERS.has(sl))return false;
      if(sl==='transportation'||sl==='transportation_name'){
        const blob=JSON.stringify(l);
        return MAJOR_ROAD.test(blob)&&!MINOR_ROAD.test(blob);
      }
      if(sl==='place'){
        return !MINOR_PLACE.test(JSON.stringify(l));
      }
      return true;
    });
    for(const layer of clone.layers){
      layer.paint=layer.paint||{};
      const sl=layer['source-layer'];
      // The source style's own zoom thresholds assume a fully-detailed map
      // (state/country labels and borders only fading in once zoomed out
      // enough that city-level clutter would otherwise dominate). Ours is
      // already stripped to just those reference layers, so let them show
      // at any zoom the radar map itself allows, instead of disappearing
      // and leaving only a city name with no sense of what state it's in.
      if(sl==='boundary'||sl==='place'){delete layer.minzoom;delete layer.maxzoom}
      if(layer.type==='background'){layer.paint['background-color']='#0a0a0a';continue}
      if(layer.type==='fill'&&(sl==='water')){layer.paint['fill-color']='#0d1117';layer.paint['fill-opacity']=1;delete layer.paint['fill-pattern'];continue}
      if(layer.type==='line'&&sl==='waterway'){layer.paint['line-color']='#0d1117';continue}
      if(layer.type==='line'&&sl==='boundary'){layer.paint['line-color']='rgba(150,150,155,0.35)';layer.paint['line-opacity']=1;continue}
      if(layer.type==='line'&&sl==='transportation'){layer.paint['line-color']=/motorway/i.test(JSON.stringify(layer))?'#6a6a6a':'#4a4a4a';layer.paint['line-opacity']=1;continue}
      if(layer.type==='symbol'){
        // Small, low-contrast labels so they read as a quiet reference layer
        // rather than competing with the radar colors for attention. The
        // glyph set itself (whichever font OpenFreeMap's "liberty" style
        // already points at) is left alone: MapLibre labels are pre-rendered
        // SDF glyphs fetched from the style's own glyphs URL, not arbitrary
        // system fonts, so swapping in "SF Pro"/"Inter" here would 404
        // instead of just changing the typeface.
        layer.paint['text-color']='#999';layer.paint['text-halo-color']='#0a0a0a';layer.paint['text-halo-width']=1.1;
        delete layer.paint['icon-color'];
        layer.layout=layer.layout||{};
        layer.layout['text-size']=sl==='place'?11:10;
        delete layer.layout['icon-image'];
        continue;
      }
    }
    return clone;
  }

  // iOS Safari has no built-in pull-to-refresh gesture (unlike some Android
  // browsers), so this reproduces the native-feeling gesture by hand: drag
  // down from the top of the page, release past a threshold, refresh.
  function mountPullToRefresh(onRefresh){
    if(!('ontouchstart'in window))return;
    const indicator=document.createElement('div');
    indicator.className='ptr-indicator';
    indicator.innerHTML='<span class="ptr-icon"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 3v6l4-2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg></span>';
    document.body.prepend(indicator);
    const icon=indicator.querySelector('.ptr-icon');
    const THRESHOLD=64,MAX=100;
    let startY=0,pulling=false,refreshing=false,dist=0,armed=false;
    function buzz(ms){try{navigator.vibrate?.(ms)}catch{}}
    function position(d){indicator.style.transform=`translate(-50%, ${-44+d}px)`;indicator.style.opacity=String(Math.min(1,d/THRESHOLD))}
    function reset(){pulling=false;dist=0;armed=false;indicator.style.transition='transform .2s ease,opacity .2s ease';position(0);icon.style.transform=''}
    reset();
    document.addEventListener('touchstart',e=>{
      if(refreshing||document.scrollingElement.scrollTop>0)return;
      startY=e.touches[0].clientY;pulling=true;armed=false;indicator.style.transition='none';
    },{passive:true});
    document.addEventListener('touchmove',e=>{
      if(!pulling||refreshing)return;
      const delta=e.touches[0].clientY-startY;
      if(delta<=0){dist=0;armed=false;position(0);return}
      dist=Math.min(MAX,delta*0.5);
      position(dist);
      icon.style.transform=`rotate(${dist*3.2}deg)`;
      if(dist>=THRESHOLD&&!armed){armed=true;buzz(10)}
      else if(dist<THRESHOLD&&armed){armed=false}
    },{passive:true});
    document.addEventListener('touchend',async()=>{
      if(!pulling||refreshing)return;
      pulling=false;
      indicator.style.transition='transform .2s ease,opacity .2s ease';
      if(dist>=THRESHOLD){
        refreshing=true;
        buzz(15);
        indicator.classList.add('spinning');
        icon.style.transform='';
        indicator.style.transform='translate(-50%, 16px)';indicator.style.opacity='1';
        try{await onRefresh()}catch{}
        indicator.classList.remove('spinning');
        refreshing=false;
      }
      reset();
    });
  }

  return {API,DEFAULT_LOC,el,esc,getSavedLocation,saveLocation,geolocate,geocodeSearch,resolveLocation,resolvePoint,json,
    emoji,local,maxWind,gustFrom,durationMs,gridValues,kphToMph,cToF,product,
    currentObservation,currentHeadline,alertLine,dayKey,startOfDay,hourLabel,dayPartLabel,dayRows,uvForDate,humidityForDate,gustForDate,maxTempForDate,minTempForDate,dayMetrics,metricsHTML,
    todayBrief,futureBrief,renderFutureCardHTML,loadTodayCard,sunMetrics,
    findTodayPeriods,renderDaysHTML,mountHeader,mountFooterNav,mountPullToRefresh,getTheme,setTheme,getThemeChoice,recolorStyleDark,minimalDarkRadarStyle};
})();
