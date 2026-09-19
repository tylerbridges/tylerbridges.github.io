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
  function listItem(label,text){return `<li><strong>${esc(label)}:</strong> ${esc(text)}</li>`}
  function concise(p){
    // Brief line: just high/low (matching the H/L chip format) and wind/gusts —
    // shortForecast and rain % already appear via the card's title/condition
    // and the Rain % chip, so they're left out here to avoid repeating them.
    const label=p.isDaytime?'H':'L';
    const gust=gustFrom(p.detailedForecast||'');
    return `${label}: ${p.temperature}°. Wind: ${p.windSpeed}${gust==null?'':` Gusts: ${gust} mph`}.`;
  }
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
  function findTodayPeriods(allPeriods,tz){
    const todayKey=dayKey(tz,new Date());
    return {
      day: allPeriods.find(p=>p.isDaytime&&dayKey(tz,p.startTime)===todayKey)||null,
      night: allPeriods.find(p=>!p.isDaytime&&dayKey(tz,p.startTime)===todayKey)||null
    };
  }
  function uvForDate(grid,dateKey,tz){const values=grid.properties?.maxUVIndex?.values||[];for(const row of values){if(dayKey(tz,row.validTime.split('/')[0])===dateKey&&row.value!=null)return Math.round(row.value)}return null}
  function humidityForDate(grid,dateKey,tz){const values=grid.properties?.relativeHumidity?.values||[];const vals=values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey).map(r=>r.value).filter(v=>v!=null);if(!vals.length)return null;return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)}
  function dayRows(allPeriods,grid,tz){
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
    return order.slice(startIdx,startIdx+7).map(key=>({...byKey[key],uv:uvForDate(grid,key,tz),humidity:humidityForDate(grid,key,tz)}));
  }
  function windAvg(windSpeed){
    const nums=(String(windSpeed).match(/\d+/g)||[]).map(Number);
    if(!nums.length)return null;
    return Math.round(nums.reduce((a,b)=>a+b,0)/nums.length);
  }
  function dayMetrics(d,n,uv,humidity){
    const b=d||n;
    const gusts=[d,n].filter(Boolean).map(p=>gustFrom(p.detailedForecast)).filter(v=>v!=null);
    const gust=gusts.length?Math.max(...gusts):null;
    const pop=d?.probabilityOfPrecipitation?.value;
    const wind=windAvg(b.windSpeed);
    return [
      ['H',`${d?.temperature??'—'}° L: ${n?.temperature??'—'}°`],
      pop==null?null:['Rain %',`${pop}%`],
      humidity==null?null:['Humidity',`${humidity}%`],
      ['Wind',`${wind==null?b.windSpeed:`${wind} mph`}${gust==null?'':` | Gusts: ${gust} mph`}`],
      uv==null?null:['Max UV',uv]
    ].filter(Boolean);
  }
  function metricsHTML(pairs){return pairs.map(([k,v])=>`<span class="metric"><b>${esc(k)}:</b> ${esc(v)}</span>`).join('')}
  function renderDaysHTML(periods,grid,tz){return dayRows(periods,grid,tz).map(r=>{const d=r.day,n=r.night,b=d||n,title=r.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:tz});const metrics=metricsHTML(dayMetrics(d,n,r.uv,r.humidity));const dayText=d?concise(d):'Daytime period has ended; not included in this NWS forecast.';const nightText=n?concise(n):'Not yet provided by NWS.';return `<article class="day"><div class="day-title"><span aria-hidden="true">${emoji(b.shortForecast)}</span> ${esc(title)}</div><div class="condition">${esc(b.shortForecast)}</div><hr><div class="detail"><ul><li>${esc(dayText)}</li><li>${esc(nightText)}</li></ul></div><div class="metrics">${metrics}</div></article>`}).join('')}

  const LOCATE_ICON='<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 2.3 4.4 20.2c-.18.42.27.85.68.66L12 17.8l6.92 3.06c.41.19.86-.24.68-.66L12 2.3z" fill="currentColor" transform="rotate(45 12 12)"/></svg>';
  const SEARCH_ICON='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function mountHeader(active,onLocationChange){
    const header=el('site-header');
    header.innerHTML=`
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
    let suggestionMap=new Map(),suggestTimer=null;
    function setKicker(text){const k=el('kicker');if(k){k.textContent=text;k.style.display=text?'':'none'}}
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
    let startY=0,pulling=false,refreshing=false,dist=0;
    function position(d){indicator.style.transform=`translate(-50%, ${-44+d}px)`;indicator.style.opacity=String(Math.min(1,d/THRESHOLD))}
    function reset(){pulling=false;dist=0;indicator.style.transition='transform .2s ease,opacity .2s ease';position(0);icon.style.transform=''}
    reset();
    document.addEventListener('touchstart',e=>{
      if(refreshing||document.scrollingElement.scrollTop>0)return;
      startY=e.touches[0].clientY;pulling=true;indicator.style.transition='none';
    },{passive:true});
    document.addEventListener('touchmove',e=>{
      if(!pulling||refreshing)return;
      const delta=e.touches[0].clientY-startY;
      if(delta<=0){dist=0;position(0);return}
      dist=Math.min(MAX,delta*0.5);
      position(dist);
      icon.style.transform=`rotate(${dist*3.2}deg)`;
    },{passive:true});
    document.addEventListener('touchend',async()=>{
      if(!pulling||refreshing)return;
      pulling=false;
      indicator.style.transition='transform .2s ease,opacity .2s ease';
      if(dist>=THRESHOLD){
        refreshing=true;
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
    emoji,local,maxWind,gustFrom,durationMs,gridValues,kphToMph,cToF,product,listItem,concise,
    currentObservation,currentHeadline,alertLine,dayKey,startOfDay,hourLabel,dayRows,uvForDate,humidityForDate,dayMetrics,metricsHTML,
    findTodayPeriods,renderDaysHTML,mountHeader,mountFooterNav,mountPullToRefresh};
})();
