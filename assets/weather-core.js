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
  function gustForDate(grid,dateKey,tz){const field=grid.properties?.windGust;const values=field?.values||[];const kph=field?.uom?.includes('km_h');const vals=values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey).map(r=>r.value).filter(v=>v!=null);if(!vals.length)return null;const max=Math.max(...vals);return Math.round(kph?max*.621371:max)}
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
    return order.slice(startIdx,startIdx+7).map(key=>({...byKey[key],uv:uvForDate(grid,key,tz),humidity:humidityForDate(grid,key,tz),gust:gustForDate(grid,key,tz)}));
  }
  function windAvg(windSpeed){
    const nums=(String(windSpeed).match(/\d+/g)||[]).map(Number);
    if(!nums.length)return null;
    return Math.round(nums.reduce((a,b)=>a+b,0)/nums.length);
  }
  function dayMetrics(d,n,uv,humidity,gridGust){
    const b=d||n;
    const gusts=[d,n].filter(Boolean).map(p=>gustFrom(p.detailedForecast)).filter(v=>v!=null);
    const textGust=gusts.length?Math.max(...gusts):null;
    const gust=gridGust??textGust;
    const pop=d?.probabilityOfPrecipitation?.value;
    const wind=windAvg(b.windSpeed);
    return [
      ['H',`${d?.temperature??'—'}° L: ${n?.temperature??'—'}°`],
      pop==null?null:['Rain %',`${pop}%`],
      humidity==null?null:['Humidity',`${humidity}%`],
      ['Wind',wind==null?esc(b.windSpeed):`${wind} mph`],
      gust==null?null:['Gusts',`${gust} mph`],
      uv==null?null:['Max UV',uv]
    ].filter(Boolean);
  }
  function metricsHTML(pairs){return pairs.map(([k,v])=>`<span class="metric"><b>${esc(k)}:</b> ${v}</span>`).join('')}
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
    const hi=d?`${d.shortForecast} with a high near ${d.temperature}°`:null;
    const lo=n?`${hi?`becoming ${n.shortForecast.toLowerCase()} tonight`:n.shortForecast} with a low near ${n.temperature}°`:null;
    if(hi&&lo)return `${hi}, ${lo}.`;
    return `${hi||lo||'Forecast unavailable'}.`;
  }
  function renderFutureCardHTML(title,d,n,metrics){
    return `<article class="brief"><h3>${esc(title)}</h3><hr><p class="condition">${esc(futureBrief(d,n))}</p><div class="metrics">${metrics}</div></article>`;
  }
  function renderDaysHTML(rows,tz){
    return rows.map(r=>{
      const d=r.day,n=r.night,b=d||n;
      const title=r.date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:tz});
      const metrics=metricsHTML(dayMetrics(d,n,r.uv,r.humidity,r.gust));
      return `<article class="day"><div class="day-title"><span aria-hidden="true">${emoji(b.shortForecast)}</span> ${esc(title)}</div><hr><p class="condition">${esc(futureBrief(d,n))}</p><div class="metrics">${metrics}</div></article>`;
    }).join('');
  }
  // Shared by the Today page and the 7-day page's first (today) card so the
  // two never drift apart: same brief statement, same metrics, same NWS
  // Alerts section, fetched and rendered by this one function.
  async function loadTodayCard(container,title,loc,point,officeId,todayPeriods,grid,tz){
    const todayKey=dayKey(tz,new Date());
    const metrics=metricsHTML(dayMetrics(todayPeriods.day,todayPeriods.night,uvForDate(grid,todayKey,tz),humidityForDate(grid,todayKey,tz),gustForDate(grid,todayKey,tz)));
    const current=await currentObservation(point).catch(()=>null);
    const currentText=current?currentHeadline(current.observation):null;
    const brief=todayBrief(currentText,todayPeriods.day,todayPeriods.night);
    const alertsRes=await json(`${API}/alerts/active?point=${loc.lat},${loc.lon}`).catch(()=>null);
    const active=alertsRes?.features||[];
    const alertsHTML=alertsRes?(active.length?active.map(a=>alertLine(a,tz)).join(''):'<p>No active NWS alerts.</p>'):'<p>Current NWS alerts could not be verified.</p>';
    const laterHTML=brief.later?`<p class="condition">${esc(brief.later)}</p>`:'';
    container.innerHTML=`<article class="brief"><h3>${esc(title)}</h3><hr><p class="now-line">${esc(brief.now)}</p>${laterHTML}<div class="metrics">${metrics}</div><hr><h3>NWS Alerts</h3><div id="alerts">${alertsHTML}</div></article>`;
    const hazardText=[todayPeriods.day?.detailedForecast,todayPeriods.night?.detailedForecast].filter(Boolean).join(' ');
    const needsHazard=active.length||/thunder|snow|ice|freezing|fog|heavy rain|blizzard/i.test(hazardText)||(gustFrom(hazardText)||0)>20;
    if(needsHazard&&officeId){
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
  const GEAR_ICON='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L1.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.6.22l2.39-.96c.5.4 1.04.71 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.58-.23 1.12-.54 1.62-.94l2.39.96c.24.1.46 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/></svg>';
  const SUN_ICON='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="4.3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="19.8" y1="4.2" x2="18" y2="6"/><line x1="6" y1="18" x2="4.2" y2="19.8"/></g></svg>';
  const MOON_ICON='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-13 7 7 0 0 0 9 13z" fill="currentColor"/></svg>';
  const THEME_KEY='weather-theme';
  function getTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark'}
  function setTheme(theme){
    if(theme==='light')document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    try{localStorage.setItem(THEME_KEY,theme)}catch{}
    document.dispatchEvent(new CustomEvent('themechange',{detail:{theme}}));
  }
  function mountHeader(active,onLocationChange){
    const header=el('site-header');
    header.innerHTML=`
      <div class="icon-row">
        <button class="icon-btn ghost" id="settings-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Settings">${GEAR_ICON}</button>
        <div class="settings-menu hidden" id="settings-menu"><a href="/credits.html">Credits</a></div>
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
    function paintThemeBtn(){
      const dark=getTheme()==='dark';
      el('theme-btn').innerHTML=dark?SUN_ICON:MOON_ICON;
      el('theme-btn').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    }
    paintThemeBtn();
    el('theme-btn').addEventListener('click',()=>{setTheme(getTheme()==='dark'?'light':'dark');paintThemeBtn()});
    el('settings-btn').addEventListener('click',e=>{
      e.stopPropagation();
      const menu=el('settings-menu'),open=!menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      el('settings-btn').setAttribute('aria-expanded',String(!open));
    });
    document.addEventListener('click',e=>{
      const menu=el('settings-menu');
      if(menu&&!menu.classList.contains('hidden')&&!menu.contains(e.target)&&e.target!==el('settings-btn')){
        menu.classList.add('hidden');el('settings-btn').setAttribute('aria-expanded','false');
      }
    });
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
    currentObservation,currentHeadline,alertLine,dayKey,startOfDay,hourLabel,dayRows,uvForDate,humidityForDate,gustForDate,dayMetrics,metricsHTML,
    todayBrief,futureBrief,renderFutureCardHTML,loadTodayCard,
    findTodayPeriods,renderDaysHTML,mountHeader,mountFooterNav,mountPullToRefresh,getTheme,setTheme,recolorStyleDark};
})();
