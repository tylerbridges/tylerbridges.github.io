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
  function listItem(label,text){return `<li><strong>${esc(label)}:</strong> ${esc(text)}</li>`}
  function shortText(p){
    const sentences=(p.detailedForecast||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+/);
    const narrative=sentences.filter(s=>! /^(?:(?:north|south|east|west|northeast|northwest|southeast|southwest|variable|light|calm|and)[ -]*)*winds?\b(?! chill)|^calm\b|^gusts?\b|^chance of precipitation is\b/i.test(s));
    let text=narrative.join(' ').trim()||p.shortForecast||'Conditions not provided.';
    if(!/\b(?:high|low|temperature|degrees|heat index|wind chill)\b/i.test(text)&&p.temperature!=null){
      text=text.replace(/[.!?]$/, '')+`. ${p.isDaytime?'High':'Low'} ${p.temperature}°${p.temperatureUnit||'F'}.`;
    }
    return text;
  }
  function concise(p){const text=p.detailedForecast||'',pop=text.match(/Chance of precipitation is (\d+)%/i)?.[1]??p.probabilityOfPrecipitation?.value;const rain=text.match(/New (?:rainfall|snow accumulation|snowfall) amounts?[^.]*\./i)?.[0]||'';const g=gustFrom(text);return `${p.shortForecast}${pop==null?'':`, ${pop}%`}. ${rain.replace('New rainfall amounts between ','Rain ').replace('New rainfall amounts ','Rain ').replace(' possible','')} Wind ${p.windSpeed}${g==null?'':` (gusts to ${g} mph)`}.`.replace(/\s+/g,' ')}
  async function currentObservation(point){
    const stations=await json(point.properties.observationStations);
    const station=stations.features?.[0]?.id;
    if(!station)throw new Error('No nearby observation station.');
    const result=await json(`${station}/observations/latest`);
    const observation=result.properties,age=Date.now()-Date.parse(observation?.timestamp);
    if(!Number.isFinite(age)||age< -300000||age>2*3600000||!observation.textDescription?.trim())throw new Error('Current conditions unavailable.');
    return {observation,confirmedAt:new Date()};
  }
  function currentHeadline(observation){
    const condition=observation.textDescription.trim();
    const value=observation.temperature?.value;
    const unit=observation.temperature?.unitCode;
    const temperature=value==null?null:unit?.endsWith('degC')?cToF(value):unit?.endsWith('degF')?Math.round(value):null;
    return `${condition}${temperature==null?'':` · ${temperature}°F`}`;
  }
  function alertLine(a,tz){const p=a.properties;return `<div class="alert"><strong>${esc(p.event)}</strong><p>${esc(p.areaDesc)}</p><p>${esc(local(p.onset||p.effective,tz))}–${esc(local(p.ends||p.expires,tz))}</p><p>${esc((p.instruction||p.description||'See NWS alert for instructions.').replace(/\s+/g,' '))}</p><a href="${esc(p['@id']||a.id)}" target="_blank" rel="noreferrer">Full NWS alert</a></div>`}
  function dayKeyOf(tz){return d=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d))}
  function findTodayPeriods(allPeriods,tz){
    const key=dayKeyOf(tz),todayKey=key(new Date());
    return {
      day: allPeriods.find(p=>p.isDaytime&&key(p.startTime)===todayKey)||null,
      night: allPeriods.find(p=>!p.isDaytime&&key(p.startTime)===todayKey)||null
    };
  }
  function dayRows(periods,grid,tz){const key=dayKeyOf(tz);const rows=[];for(let i=0;i<periods.length&&rows.length<7;i++){const p=periods[i];if(!p.isDaytime&&rows.length)continue;let day=p.isDaytime?p:null,night=p.isDaytime?periods[i+1]:p;if(day&&night?.isDaytime)night=null;const base=day||night;const date=new Date(base.startTime);const dayKey=key(date);const uv=uvForDate(grid,dayKey,tz);rows.push({date,day,night,uv});if(day&&night)i++}return rows}
  function uvForDate(grid,dateKey,tz){const key=dayKeyOf(tz);const values=grid.properties?.maxUVIndex?.values||[];for(const row of values){if(key(row.validTime.split('/')[0])===dateKey&&row.value!=null)return Math.round(row.value)}return null}
  function renderDaysHTML(periods,grid,tz){return dayRows(periods,grid,tz).map(r=>{const d=r.day,n=r.night,b=d||n,title=r.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:tz});const gusts=[d,n].filter(Boolean).map(p=>gustFrom(p.detailedForecast)).filter(v=>v!=null),gust=gusts.length?Math.max(...gusts):null;const pop=d?.probabilityOfPrecipitation?.value;const metrics=[['High / low',`${d?.temperature??'—'}° / ${n?.temperature??'—'}°`],[gust==null?'Wind':'Wind / peak gust',`${b.windSpeed}${gust==null?'':` / ${gust} mph`}`],pop==null?null:['Day rain chance',`${pop}%`],r.uv==null?null:['Max UV',r.uv]].filter(Boolean).map(([k,v])=>`<span class="metric"><b>${esc(k)}:</b>&nbsp;${esc(v)}</span>`).join('');return `<article class="day"><div class="day-title"><span aria-hidden="true">${emoji(b.shortForecast)}</span> ${esc(title)}</div><div class="condition">${esc(b.shortForecast)}</div><div class="metrics">${metrics}</div><hr><div class="detail"><ul>${listItem('Day',d?shortText(d):'Daytime period has ended; not included in this NWS forecast.')}${listItem('Night',n?shortText(n):'Not yet provided by NWS.')}</ul></div></article>`}).join('')}

  function mountHeader(active,onLocationChange){
    const header=el('site-header');
    header.innerHTML=`
      <nav class="tabs" aria-label="Pages">
        <a href="/" class="tab${active==='today'?' active':''}">Today</a>
        <a href="/forecast.html" class="tab${active==='forecast'?' active':''}">7-Day</a>
        <a href="/radar.html" class="tab${active==='radar'?' active':''}">Radar</a>
      </nav>
      <form id="location-form" class="location-form" role="search">
        <input id="location-input" list="location-suggestions" type="text" inputmode="search" autocomplete="off" placeholder="City, state or ZIP" aria-label="Search for a location">
        <datalist id="location-suggestions"></datalist>
        <button class="loc-btn" type="submit" aria-label="Search location">🔎</button>
        <button class="loc-btn" id="locate-btn" type="button" aria-label="Use current location">📍</button>
      </form>`;
    let suggestionMap=new Map(),suggestTimer=null;
    function setKicker(text){const k=el('kicker');if(k)k.textContent=text}
    function pick(pos,query){
      saveLocation({...pos,label:null,source:'search',query});
      el('location-input').value='';el('location-suggestions').innerHTML='';suggestionMap.clear();
      onLocationChange();
    }
    el('location-input').addEventListener('input',()=>{
      clearTimeout(suggestTimer);
      const q=el('location-input').value.trim();
      if(suggestionMap.has(q)){setKicker('Loading…');pick(suggestionMap.get(q),q);return}
      if(q.length<3){suggestionMap.clear();el('location-suggestions').innerHTML='';return}
      suggestTimer=setTimeout(async()=>{
        try{
          const results=await json(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q=${encodeURIComponent(q)}`);
          suggestionMap=new Map(results.map(r=>[r.display_name,{lat:+(+r.lat).toFixed(4),lon:+(+r.lon).toFixed(4)}]));
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

  return {API,DEFAULT_LOC,el,esc,getSavedLocation,saveLocation,geolocate,geocodeSearch,resolveLocation,resolvePoint,json,
    emoji,local,maxWind,gustFrom,durationMs,gridValues,kphToMph,cToF,product,listItem,shortText,concise,
    currentObservation,currentHeadline,alertLine,dayRows,uvForDate,findTodayPeriods,renderDaysHTML,mountHeader};
})();
