window.WX = (function(){
  const API='https://api.weather.gov',LOC_KEY='weather-location',POINT_CACHE_KEY='weather-point-cache',POINT_TTL=3*86400000,TIME_ZONE_KEY='weather-time-zone',DEFAULT_TIME_ZONE='America/Chicago',DEFAULT_LOC={lat:44.0136,lon:-92.4757,label:'Rochester, Minnesota',source:'default'};
  const TEMP_UNIT_KEY='weather-temp-unit',WIND_UNIT_KEY='weather-wind-unit',HOUR_FORMAT_KEY='weather-hour-format';
  const TIME_ZONES=['America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','America/Anchorage','America/Adak','Pacific/Honolulu','America/Puerto_Rico','Pacific/Guam','Pacific/Pago_Pago'];
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let currentLoc=null,sessionTimeZone=null,timeZoneSetupPromise=null;

  // Anything read back from storage is validated before use: a corrupted or
  // hand-edited entry (e.g. {} or {lat:"x"}) would otherwise throw deep inside
  // .toFixed() or build an api.weather.gov URL containing "undefined".
  const validLoc=l=>!!l&&typeof l==='object'&&Number.isFinite(l.lat)&&Number.isFinite(l.lon)&&Math.abs(l.lat)<=90&&Math.abs(l.lon)<=180;
  const cleanLoc=l=>({...l,label:typeof l.label==='string'?l.label:null});
  function getSavedLocation(){try{const loc=JSON.parse(localStorage.getItem(LOC_KEY));return validLoc(loc)?cleanLoc(loc):null}catch{return null}}
  function saveLocation(loc){currentLoc=loc;try{localStorage.setItem(LOC_KEY,JSON.stringify(loc))}catch{}}
  // currentLoc (in-memory) is set even when resolveLocation() falls back to
  // DEFAULT_LOC without persisting it, so prefer it over the possibly-stale
  // or empty localStorage read.
  function getCurrentLocation(){return currentLoc||getSavedLocation()||DEFAULT_LOC}

  const SAVED_LOCS_KEY='weather-saved-locations',MAX_SAVED_LOCS=10;
  // Rounded to the same precision as the point-lookup cache key so trivial
  // GPS jitter doesn't register as a different place.
  const savedLocKey=loc=>`${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  function getSavedLocations(){try{const list=JSON.parse(localStorage.getItem(SAVED_LOCS_KEY));return Array.isArray(list)?list.filter(validLoc).map(l=>({...cleanLoc(l),label:cleanLoc(l).label||'Selected location',favorite:l.favorite===true})):[]}catch{return[]}}
  function setSavedLocations(list){try{localStorage.setItem(SAVED_LOCS_KEY,JSON.stringify(list))}catch{}document.dispatchEvent(new CustomEvent('savedlocationschange'))}
  function findSavedLocation(loc){const key=savedLocKey(loc);return getSavedLocations().find(l=>savedLocKey(l)===key)||null}
  function isLocationSaved(loc){return !!findSavedLocation(loc)}
  function addSavedLocation(loc){
    const key=savedLocKey(loc),list=getSavedLocations().filter(l=>savedLocKey(l)!==key);
    list.unshift({lat:loc.lat,lon:loc.lon,label:loc.label||'Selected location',favorite:false});
    setSavedLocations(list.slice(0,MAX_SAVED_LOCS));
  }
  function removeSavedLocation(loc){const key=savedLocKey(loc);setSavedLocations(getSavedLocations().filter(l=>savedLocKey(l)!==key))}
  function toggleSavedLocation(loc){if(isLocationSaved(loc))removeSavedLocation(loc);else addSavedLocation(loc)}
  // Only one favorite at a time — starring a second place un-stars the first.
  function setFavoriteLocation(loc){
    const key=savedLocKey(loc);
    let list=getSavedLocations();
    if(!list.some(l=>savedLocKey(l)===key))list=[{lat:loc.lat,lon:loc.lon,label:loc.label||'Selected location',favorite:false},...list].slice(0,MAX_SAVED_LOCS);
    setSavedLocations(list.map(l=>({...l,favorite:savedLocKey(l)===key})));
  }
  function clearFavoriteLocation(){setSavedLocations(getSavedLocations().map(l=>l.favorite?{...l,favorite:false}:l))}
  function toggleFavoriteLocation(loc){findSavedLocation(loc)?.favorite?clearFavoriteLocation():setFavoriteLocation(loc)}
  function getFavoriteLocation(){return getSavedLocations().find(l=>l.favorite)||null}

  const STARTUP_MODE_KEY='weather-startup-mode',STARTUP_CHECKED_KEY='weather-startup-checked';
  function getStartupMode(){try{return localStorage.getItem(STARTUP_MODE_KEY)==='favorite'?'favorite':'last'}catch{return'last'}}
  function setStartupMode(mode){if(mode!=='last'&&mode!=='favorite')return;try{localStorage.setItem(STARTUP_MODE_KEY,mode)}catch{}}
  function validTimeZone(zone){try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format();return true}catch{return false}}
  function storedTimeZone(){try{const zone=localStorage.getItem(TIME_ZONE_KEY);return zone&&validTimeZone(zone)?zone:null}catch{return null}}
  function getTimeZone(){return storedTimeZone()||sessionTimeZone||DEFAULT_TIME_ZONE}
  function setTimeZone(zone){if(!validTimeZone(zone))return;sessionTimeZone=zone;try{localStorage.setItem(TIME_ZONE_KEY,zone)}catch{}document.dispatchEvent(new CustomEvent('timezonechange',{detail:{timeZone:zone}}))}
  function timeZoneLabel(zone){
    const known={'America/New_York':'Eastern Time','America/Chicago':'Central Time','America/Denver':'Mountain Time','America/Phoenix':'Arizona Time','America/Los_Angeles':'Pacific Time','America/Anchorage':'Alaska Time','America/Adak':'Hawaii–Aleutian Time','Pacific/Honolulu':'Hawaii Time','America/Puerto_Rico':'Atlantic Time','Pacific/Guam':'Chamorro Time','Pacific/Pago_Pago':'Samoa Time'};
    if(known[zone])return known[zone];
    try{return new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||zone}catch{return zone}
  }
  function deviceTimeZone(){try{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;return validTimeZone(zone)?zone:DEFAULT_TIME_ZONE}catch{return DEFAULT_TIME_ZONE}}
  // Unit preferences (temperature, wind speed, clock format) follow the same
  // stored-choice pattern as theme/time zone: 'unitschange' lets every page
  // just re-render with the new preference instead of refetching data, since
  // all underlying values are stored in Fahrenheit/mph regardless of display unit.
  function getTempUnit(){try{return localStorage.getItem(TEMP_UNIT_KEY)==='C'?'C':'F'}catch{return'F'}}
  function setTempUnit(unit){if(unit!=='F'&&unit!=='C')return;try{localStorage.setItem(TEMP_UNIT_KEY,unit)}catch{}document.dispatchEvent(new CustomEvent('unitschange'))}
  function getWindUnit(){try{return localStorage.getItem(WIND_UNIT_KEY)==='kmh'?'kmh':'mph'}catch{return'mph'}}
  function setWindUnit(unit){if(unit!=='mph'&&unit!=='kmh')return;try{localStorage.setItem(WIND_UNIT_KEY,unit)}catch{}document.dispatchEvent(new CustomEvent('unitschange'))}
  function getHourFormat(){try{return localStorage.getItem(HOUR_FORMAT_KEY)==='24'?'24':'12'}catch{return'12'}}
  function setHourFormat(format){if(format!=='12'&&format!=='24')return;try{localStorage.setItem(HOUR_FORMAT_KEY,format)}catch{}document.dispatchEvent(new CustomEvent('unitschange'))}
  function hour12(){return getHourFormat()!=='24'}
  function tempValue(f){return getTempUnit()==='C'?Math.round((f-32)*5/9):Math.round(f)}
  function tempUnitLabel(){return getTempUnit()}
  function fmtTemp(f){return f==null?'':`${tempValue(f)}°${tempUnitLabel()}`}
  // Shared by every hi/lo or feels-like range so the unit only appears once,
  // after the higher bound, instead of after each number in the pair.
  function fmtTempRange(lo,hi){
    if(lo==null&&hi==null)return'';
    if(lo!=null&&hi!=null)return lo===hi?fmtTemp(lo):`${tempValue(lo)}°–${fmtTemp(hi)}`;
    return fmtTemp(hi??lo);
  }
  function windValue(mph){return getWindUnit()==='kmh'?Math.round(mph*1.60934):Math.round(mph)}
  function windUnitLabel(){return getWindUnit()==='kmh'?'km/h':'mph'}
  function fmtWind(mph){return mph==null?'':`${windValue(mph)} ${windUnitLabel()}`}
  const SHOW_FEELS_LIKE_KEY='weather-show-feels-like';
  function getShowFeelsLike(){try{return localStorage.getItem(SHOW_FEELS_LIKE_KEY)!=='false'}catch{return true}}
  function setShowFeelsLike(show){try{localStorage.setItem(SHOW_FEELS_LIKE_KEY,show?'true':'false')}catch{}document.dispatchEvent(new CustomEvent('unitschange'))}
  const REFRESH_KEY='weather-refresh-minutes',REFRESH_OPTIONS=[0,5,10,30];
  function getRefreshInterval(){try{const v=parseInt(localStorage.getItem(REFRESH_KEY),10);return REFRESH_OPTIONS.includes(v)?v:10}catch{return 10}}
  function setRefreshInterval(minutes){if(!REFRESH_OPTIONS.includes(minutes))return;try{localStorage.setItem(REFRESH_KEY,String(minutes))}catch{}document.dispatchEvent(new CustomEvent('refreshintervalchange'))}
  // Lets each page hand a single callback to a shared, restartable timer
  // instead of hardcoding its own setInterval, so changing the auto-refresh
  // setting takes effect immediately on an already-open page.
  function scheduleAutoRefresh(callback){
    let timer=null;
    function arm(){clearInterval(timer);const minutes=getRefreshInterval();if(minutes>0)timer=setInterval(callback,minutes*60000)}
    arm();
    document.addEventListener('refreshintervalchange',arm);
  }
  // Single source of truth for the Settings time-zone picker, used both by
  // settings.html's own markup and by the header's subpage-modal copy of it
  // (mountHeader fetches settings.html and reuses its .credit-list markup),
  // so the two can't drift the way a second hardcoded <option> list would.
  function timeZoneOptionsHTML(){return TIME_ZONES.map(zone=>`<option value="${esc(zone)}">${esc(timeZoneLabel(zone))}</option>`).join('')}
  function ensureTimeZone(){
    const saved=storedTimeZone();if(saved)return Promise.resolve(saved);
    if(timeZoneSetupPromise)return timeZoneSetupPromise;
    const detected=deviceTimeZone(),zones=TIME_ZONES.includes(detected)?TIME_ZONES:[detected,...TIME_ZONES];
    timeZoneSetupPromise=new Promise(resolve=>{
      const id='time-zone-prompt';el(id)?.remove();
      const options=zones.map(zone=>`<option value="${esc(zone)}"${zone===detected?' selected':''}>${esc(timeZoneLabel(zone))}</option>`).join('');
      document.body.insertAdjacentHTML('beforeend',`<dialog class="timezone-dialog" id="${id}" aria-labelledby="time-zone-prompt-title" aria-describedby="time-zone-prompt-copy"><div class="timezone-dialog-card"><h2 id="time-zone-prompt-title">Choose your time zone</h2><p id="time-zone-prompt-copy">Your device suggests <strong>${esc(timeZoneLabel(detected))}</strong>. This setting controls every weather date and time and will stay the same when you view another location.</p><label class="sr-only" for="time-zone-setup-choice">Weather time zone</label><select class="setting-select" id="time-zone-setup-choice">${options}</select><div class="timezone-dialog-actions"><button class="choice-btn active" type="button" data-time-zone-confirm>Continue</button></div></div></dialog>`);
      const dialog=el(id),select=el('time-zone-setup-choice');let finished=false;
      function finish(){if(finished)return;finished=true;setTimeZone(select.value||detected);if(dialog.open)dialog.close();dialog.remove();resolve(getTimeZone())}
      dialog.querySelector('[data-time-zone-confirm]').addEventListener('click',finish);
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish()});
      dialog.addEventListener('click',e=>{if(e.target===dialog)finish()});
      dialog.showModal();select.focus();
    });
    return timeZoneSetupPromise;
  }
  function pointCacheKey(lat,lon){return `${lat.toFixed(2)},${lon.toFixed(2)}`}
  function getCachedPoint(lat,lon){try{const all=JSON.parse(localStorage.getItem(POINT_CACHE_KEY)||'{}');const entry=all[pointCacheKey(lat,lon)];if(entry&&Date.now()-entry.ts<POINT_TTL&&entry.point?.properties?.forecast)return entry.point}catch{}return null}
  function setCachedPoint(lat,lon,point){try{const all=JSON.parse(localStorage.getItem(POINT_CACHE_KEY)||'{}');all[pointCacheKey(lat,lon)]={point,ts:Date.now()};const keys=Object.keys(all);if(keys.length>5){keys.sort((a,b)=>all[a].ts-all[b].ts);delete all[keys[0]]}localStorage.setItem(POINT_CACHE_KEY,JSON.stringify(all))}catch{}}
  function geolocate(opts={}){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Geolocation unsupported'));navigator.geolocation.getCurrentPosition(pos=>resolve({lat:+pos.coords.latitude.toFixed(4),lon:+pos.coords.longitude.toFixed(4)}),reject,{enableHighAccuracy:false,timeout:5000,maximumAge:600000,...opts})})}
  const SEARCH_ALIASES=new Map([
    ['jackson hole','Jackson, Wyoming'],
    ['jackson hole wy','Jackson, Wyoming'],
    ['jackson hole wyoming','Jackson, Wyoming']
  ]);
  function normalizedSearchQuery(query){const trimmed=String(query||'').trim(),key=trimmed.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');return SEARCH_ALIASES.get(key)||trimmed}
  // Photon (komoot.io) instead of Nominatim's own public endpoint: same
  // underlying OpenStreetMap place data and general place-search behavior
  // (unlike a street-address-focused geocoder), but explicitly positioned
  // for this kind of public reuse rather than Nominatim's "light use only"
  // policy. Nominatim's countrycodes=us restricts results server-side;
  // Photon's public API has no equivalent country filter, so results are
  // over-fetched and filtered to US matches client-side instead, to keep
  // ambiguous place names (e.g. a city sharing a name abroad) resolving the
  // way they did before.
  const GEOCODE_ROOT='https://photon.komoot.io/api/';
  // Photon's public instance is fair-use only, so identical queries (the
  // suggestion list and a follow-up Enter for the same text) are answered
  // from memory instead of asking again.
  const geocodeCache=new Map();
  async function geocodePhoton(query,limit,signal){
    const url=`${GEOCODE_ROOT}?limit=${limit}&lang=en&q=${encodeURIComponent(normalizedSearchQuery(query))}`;
    if(geocodeCache.has(url))return geocodeCache.get(url);
    const data=await json(url,{signal});
    let features=(data.features||[]).filter(f=>f.properties?.countrycode==='US').map((f,i)=>({f,i})).sort((a,b)=>featureRank(a.f)-featureRank(b.f)||a.i-b.i).map(x=>x.f);
    // A street or building only helps when no town or ZIP matched at all.
    if(features.some(f=>featureRank(f)<2))features=features.filter(f=>featureRank(f)<2);
    geocodeCache.set(url,features);
    if(geocodeCache.size>50)geocodeCache.delete(geocodeCache.keys().next().value);
    return features;
  }
  function photonPosition(feature){const[lon,lat]=feature.geometry.coordinates;return {lat:+(+lat).toFixed(4),lon:+(+lon).toFixed(4)}}
  async function geocodeSearch(query){const features=await geocodePhoton(query,10);if(!features.length)throw new Error('Location not found.');return photonPosition(features[0])}
  const US_STATE_ABBR={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC','Puerto Rico':'PR',Guam:'GU','American Samoa':'AS','U.S. Virgin Islands':'VI','Northern Mariana Islands':'MP'};
  // Photon returns a town or village as the place itself (osm_key "place",
  // or type "city"/"district"/"locality"): its own name is the answer, and
  // it has no separate `city` field. Only things *inside* a place (streets,
  // buildings, ZIP areas) carry `city`. Falling back to `county` for the
  // former is what labelled Ellenboro, NC as "Rutherford, NC".
  const isPostcode=p=>p.osm_value==='postcode'||p.type==='postcode';
  const isSettlement=p=>!isPostcode(p)&&(p.osm_key==='place'||['city','district','locality'].includes(p.type));
  function normalizedLabel(feature){
    const p=feature.properties||{};
    const place=isSettlement(p)?p.name:p.city||p.name||p.county;
    const state=US_STATE_ABBR[p.state]||p.state;
    return place&&state?`${place}, ${state}`:[place,p.state].filter(Boolean).join(', ');
  }
  // Towns first, then ZIP areas, then everything else (streets, buildings,
  // counties), keeping Photon's own relevance order within each group.
  const featureRank=f=>{const p=f.properties||{};return isSettlement(p)?0:isPostcode(p)?1:2};
  // Only ever re-reads the position when the person has already granted
  // permission, so a background refresh can never surface a prompt.
  async function geoPermissionGranted(){try{return (await navigator.permissions?.query({name:'geolocation'}))?.state==='granted'}catch{return false}}
  function refreshGeoInBackground(saved){geoPermissionGranted().then(ok=>ok?geolocate({maximumAge:0}):Promise.reject()).then(pos=>{const sameSpot=saved.lat===pos.lat&&saved.lon===pos.lon;saveLocation({...pos,label:sameSpot?saved.label:null,source:'geo'})}).catch(()=>{})}
  async function resolveLocation(){
    await ensureTimeZone();
    // Only overrides the first resolve of a browsing session (cold start),
    // never a later refresh or a move to another page in the same tab —
    // otherwise "always show favorite" would fight a location the user just
    // searched for or jumped to. The flag lives in sessionStorage because each
    // tab (Today → Hourly) is a fresh page load that would reset an in-memory
    // one. It also only takes effect when a favorite actually exists;
    // otherwise this falls through to the normal last-used order below
    // exactly as if the setting were off.
    let startupChecked=false;
    try{startupChecked=sessionStorage.getItem(STARTUP_CHECKED_KEY)==='1';sessionStorage.setItem(STARTUP_CHECKED_KEY,'1')}catch{}
    if(!startupChecked){
      if(getStartupMode()==='favorite'){
        const favorite=getFavoriteLocation();
        if(favorite){currentLoc=favorite;return favorite}
      }
    }
    const saved=getSavedLocation();
    if(saved){
      currentLoc=saved;
      if(saved.source==='geo')refreshGeoInBackground(saved);
      return saved;
    }
    // No prompt on a first visit: the browser's location request only ever
    // follows the person pressing the locate button. Until then the default
    // location is shown, and pages flag it as such (see mountStatus).
    const loc={...DEFAULT_LOC};currentLoc=loc;return loc;
  }
  // Carries which service failed and how, so pages can say something useful
  // ("the National Weather Service isn't responding") instead of a raw
  // "Failed to fetch".
  class FetchError extends Error{
    constructor(message,{service,status=0,url=''}={}){super(message);this.name='FetchError';this.service=service;this.status=status;this.url=url}
  }
  const serviceName=url=>url.startsWith(API)?'the National Weather Service':url.startsWith(GEOCODE_ROOT)?'location search':'a weather data service';
  // Short-lived response cache in sessionStorage. Every page is its own load,
  // so without it moving Today → Hourly → 7-Day re-downloads the same
  // forecast three times. A manual refresh raises cacheFloor so it always
  // goes back to the network.
  const RESPONSE_CACHE_PREFIX='wx-cache:',MAX_CACHED_CHARS=1500000;
  const CACHE_TTL={forecast:5*60000,alerts:2*60000,products:10*60000,stations:86400000};
  let cacheFloor=0;
  function bypassCache(){cacheFloor=Date.now()}
  function readCached(url,ttl){
    try{const entry=JSON.parse(sessionStorage.getItem(RESPONSE_CACHE_PREFIX+url));if(entry&&entry.ts>cacheFloor&&Date.now()-entry.ts<ttl)return entry.data}catch{}
    return null;
  }
  function clearResponseCache(){try{Object.keys(sessionStorage).filter(k=>k.startsWith(RESPONSE_CACHE_PREFIX)).forEach(k=>sessionStorage.removeItem(k))}catch{}}
  function writeCached(url,data){
    const value=JSON.stringify({ts:Date.now(),data});
    if(value.length>MAX_CACHED_CHARS)return;
    try{sessionStorage.setItem(RESPONSE_CACHE_PREFIX+url,value)}
    catch{clearResponseCache();try{sessionStorage.setItem(RESPONSE_CACHE_PREFIX+url,value)}catch{}}
  }
  // One retry at most, after a randomized 1–2 s pause, and only for failures
  // a retry can fix (network errors, timeouts, 5xx). A 4xx — including 429
  // "slow down" — is final, so a struggling service is never hammered.
  async function json(url,{ttl=0,signal}={}){
    if(ttl){const hit=readCached(url,ttl);if(hit)return hit}
    const service=serviceName(url);
    let last;
    for(let attempt=0;attempt<2;attempt++){
      if(attempt)await new Promise(resolve=>setTimeout(resolve,1000+Math.random()*1000));
      if(signal?.aborted)throw signal.reason;
      const timeout=AbortSignal.timeout(20000),combined=signal&&AbortSignal.any?AbortSignal.any([signal,timeout]):signal||timeout;
      let response;
      try{response=await fetch(url,{headers:{Accept:'application/geo+json, application/json'},signal:combined})}
      catch(e){
        if(signal?.aborted)throw e;
        last=new FetchError(`Couldn't reach ${service}.`,{service,url});
        if(navigator.onLine===false)break;
        continue;
      }
      if(!response.ok){
        last=new FetchError(`${service[0].toUpperCase()+service.slice(1)} returned an error (${response.status}).`,{service,status:response.status,url});
        if(response.status<500&&response.status!==408)break;
        continue;
      }
      const data=await response.json();
      if(ttl)writeCached(url,data);
      return data;
    }
    throw last;
  }
  // Plain-language version of a load failure for the page's error/stale
  // banners. Errors the pages throw themselves (stale forecast, etc.) are
  // already written for people and pass straight through.
  function friendlyError(e){
    if(navigator.onLine===false)return "You're offline. The forecast will load again when your connection is back.";
    // Only the page's own plain Error messages are written for people; a
    // TypeError/SyntaxError from malformed data is not.
    if(!(e instanceof FetchError))return e?.name==='Error'&&e.message?e.message:'Something went wrong loading the forecast. Try again in a moment.';
    if(e.status===404&&/\/points\//.test(e.url))return 'Forecasts are only available for locations in the United States and its territories. Try searching for a US city or ZIP.';
    if(e.status===429)return `${e.service[0].toUpperCase()+e.service.slice(1)} is limiting requests right now. Try again in a minute.`;
    if(e.status>=500)return `${e.service[0].toUpperCase()+e.service.slice(1)} isn't responding right now (error ${e.status}). Try again in a few minutes.`;
    if(e.status)return `${e.service[0].toUpperCase()+e.service.slice(1)} couldn't answer that request (error ${e.status}).`;
    return `Couldn't reach ${e.service}. Check your connection and try again.`;
  }

  async function resolvePoint(loc){
    let point=getCachedPoint(loc.lat,loc.lon);
    if(!point){point=await json(`${API}/points/${loc.lat},${loc.lon}`);setCachedPoint(loc.lat,loc.lon,point)}
    const rel=point.properties.relativeLocation?.properties;
    const label=rel?`${rel.city}, ${rel.state}`:loc.label||'Selected location';
    if(loc.label!==label)saveLocation({...loc,label});
    const tz=getTimeZone();
    const officeId=(point.properties.forecastOffice||'').split('/').pop();
    const countyId=(point.properties.county||'').split('/').pop();
    const zoneId=(point.properties.forecastZone||'').split('/').pop();
    return {point,label,tz,officeId,countyId,zoneId};
  }

  function emoji(text){const t=String(text).toLowerCase();return /thunder/.test(t)?'⛈️':/snow|blizzard/.test(t)?'🌨️':/ice|freezing|sleet/.test(t)?'🧊':/rain|shower|drizzle/.test(t)?'🌧️':/fog|mist/.test(t)?'☁️':/partly|mostly sunny/.test(t)?'🌤️':/cloud|overcast/.test(t)?'☁️':/sun|clear/.test(t)?'☀️':'🌡️'}
  const local=(t,tz,options={})=>t?new Date(t).toLocaleString('en-US',{timeZone:tz||getTimeZone(),month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:hour12(),timeZoneName:'short',...options}):'Not provided';
  function maxWind(s){const n=(String(s).match(/\d+/g)||[]).map(Number);return n.length?Math.max(...n):null}
  function gustFrom(text){const m=String(text).match(/gusts?(?: as high as| up to| near| to)?\s*(\d+)\s*mph/i);return m?+m[1]:null}
  function durationMs(iso){const m=iso.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);return m?((+m[1]||0)*864e5+(+m[2]||0)*36e5+(+m[3]||0)*6e4):36e5}
  function gridValues(field,times,convert=v=>v){if(!field?.values)return times.map(()=>null);return times.map(t=>{const ms=t.getTime();for(const row of field.values){const [start,dur='PT1H']=row.validTime.split('/');const a=new Date(start).getTime();if(ms>=a&&ms<a+durationMs(dur))return row.value==null?null:convert(row.value)}return null})}
  const kphToMph=v=>Math.round(v*.621371), cToF=v=>Math.round(v*9/5+32);
  async function product(type,officeId){try{const list=await json(`${API}/products/types/${type}/locations/${officeId}`,{ttl:CACHE_TTL.products});const item=(list['@graph']||[])[0];if(!item?.id)return null;return await json(item.id.startsWith('http')?item.id:`${API}/products/${item.id}`,{ttl:CACHE_TTL.products})}catch{return null}}
  // Great-circle distance in miles between two [lon,lat] points.
  function milesBetween([lon1,lat1],[lon2,lat2]){
    const R=3958.8,toRad=d=>d*Math.PI/180;
    const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  // A gridpoint's station list is static metadata, and both the current
  // conditions and the chart history need it on every refresh — fetch it
  // once per location instead of twice every ten minutes.
  const stationListCache=new Map();
  function stationList(url){
    if(!stationListCache.has(url))stationListCache.set(url,json(url,{ttl:CACHE_TTL.stations}).catch(e=>{stationListCache.delete(url);throw e}));
    return stationListCache.get(url);
  }
  async function stationCandidates(point){
    const stations=await stationList(point.properties.observationStations);
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
    return ids;
  }
  // Observed hourly readings from `since` to now. NWS forecast data only
  // describes the future, so this is what fills the already-elapsed part of
  // today's charts — actual measurements rather than a back-dated forecast.
  async function observationHistory(point,since){
    const ids=await stationCandidates(point);
    const start=new Date(since).toISOString();
    let last=new Error('Observation history unavailable.');
    for(const station of ids){
      try{
        const result=await json(`${station}/observations?start=${encodeURIComponent(start)}&limit=200`,{ttl:CACHE_TTL.forecast});
        const readings=(result.features||[]).map(f=>f.properties).filter(p=>p&&p.timestamp);
        if(!readings.length)throw new Error('Observation history unavailable.');
        return readings;
      }catch(e){last=e}
    }
    throw last;
  }
  async function currentObservation(point){
    const ids=await stationCandidates(point);
    // The nearest station is sometimes offline or stale (unmaintained gauge,
    // outage, etc.) — try the next-closest ones in order rather than giving
    // up on the whole location after one bad station.
    let last=new Error('Current conditions unavailable.');
    for(const station of ids){
      try{
        const result=await json(`${station}/observations/latest`,{ttl:CACHE_TTL.forecast});
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
    return `${condition}${temperature==null?'':` · ${fmtTemp(temperature)}`}`;
  }
  // NWS's modern CAP alert feed is normally already mixed-case, but the
  // classic teletype-style text products (HWO/AFD) are still issued in full
  // caps, and some legacy CAP alerts still come through shouting too. Only
  // reflow text that's actually predominantly uppercase, so already-normal
  // text passes through untouched; this can't recover mid-sentence proper
  // nouns from all-caps source, but it's far more readable than shouting.
  // Words worth restoring after a blind lowercase pass: unambiguous
  // weather-text acronyms and weekday names. Deliberately excludes state
  // codes and month names — too many collide with common English words
  // (OR/IN/ME/HI, "may occur") to restore blindly without a real parser.
  const CASE_RESTORE=new Map(['NWS','NOAA','NEXRAD','CST','CDT','MST','MDT','PST','PDT','AKST','AKDT','HST','EST','EDT',
    'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(w=>[w.toLowerCase(),w]));
  function toSentenceCase(text){
    const letters=text.replace(/[^a-z]/gi,'');
    const upper=letters.replace(/[^A-Z]/g,'');
    if(letters.length<12||upper.length/letters.length<0.7)return text;
    // Restore acronyms/weekdays before capitalizing sentence starts — doing
    // it after would miss a restored word that opens a sentence, since the
    // capitalization pass only touches a still-lowercase leading letter.
    return text.toLowerCase()
      .replace(/\b[a-z]+\b/g,w=>CASE_RESTORE.get(w)||w)
      .replace(/(^\s*[a-z]|[.!?]\s+[a-z]|\bi\b)/g,m=>m.toUpperCase());
  }
  // NWS product/alert text gives the issuing office as "NWS City ST" (alert
  // senderName) or "National Weather Service City ST" (a text product's own
  // header line, followed by more text) — neither has a comma before the
  // state, so this adds one for a readable "NWS City, ST" label.
  function officeLabel(rawText,officeId){
    const m=String(rawText||'').match(/(?:National Weather Service|NWS)\s+([A-Za-z .]+?)\s+([A-Z]{2})(?=\s|$)/);
    if(m)return `NWS ${m[1].trim()}, ${m[2]}`;
    return officeId?`NWS ${officeId}`:'NWS';
  }
  // Pulls the sentence (plus the one after it) that triggered hazard
  // guidance out of a full HWO/AFD text product, rather than showing the
  // whole multi-section product inline.
  function hazardExcerpt(text){
    if(!text)return null;
    const sentences=text.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/);
    const idx=sentences.findIndex(s=>/severe|tornado|hail|damaging|blizzard|flood/i.test(s));
    if(idx<0)return null;
    return toSentenceCase(sentences.slice(idx,idx+2).join(' ').trim());
  }
  function hwoCardHTML(hwo,officeId,loc,tz){
    const office=officeLabel(hwo.productText,officeId);
    const place=esc((loc.label||'your area').split(',')[0]);
    const href=safeNwsUrl(hwo['@id'])||(hwo.id?`${API}/products/${encodeURIComponent(hwo.id)}`:null);
    const linkHTML=href?`<a href="${esc(href)}" target="_blank" rel="noreferrer">Full NWS product</a>`:'';
    return `<div class="alert alert-outlook"><h4>Hazardous Weather Outlook — ${esc(office)}</h4><p>Regional guidance for the ${esc(office)} area — not an issued alert, and may not apply to ${place}.</p><p>Issued ${esc(local(hwo.issuanceTime,tz))}</p><p>${esc(hazardExcerpt(hwo.productText)||'See the full outlook for details.')}</p>${linkHTML}</div>`;
  }
  // Links taken from API data are only used when they point back at
  // api.weather.gov itself; esc() alone would let a javascript: URL through.
  const safeNwsUrl=url=>typeof url==='string'&&url.startsWith(`${API}/`)?url:null;
  // Colour-codes alerts the way NWS does in its own products: warnings
  // (act now) above watches (be ready) above advisories and statements.
  const ALERT_LEVELS=['warning','watch','advisory','statement'];
  function alertLevel(p){
    const event=String(p?.event||'');
    if(/warning|emergency/i.test(event)||p?.severity==='Extreme')return 'warning';
    if(/watch/i.test(event))return 'watch';
    if(/advisory/i.test(event))return 'advisory';
    return 'statement';
  }
  function activeAlerts(loc){
    return json(`${API}/alerts/active?point=${loc.lat},${loc.lon}`,{ttl:CACHE_TTL.alerts})
      .then(res=>(res?.features||[]).filter(a=>a?.properties).sort((a,b)=>ALERT_LEVELS.indexOf(alertLevel(a.properties))-ALERT_LEVELS.indexOf(alertLevel(b.properties))));
  }
  function alertLine(a,tz){
    const p=a.properties,level=alertLevel(p);
    const title=`${esc(p.event)} — ${esc(officeLabel(p.senderName))}`;
    const body=toSentenceCase((p.instruction||p.description||'See NWS alert for instructions.').replace(/\s+/g,' '));
    const href=safeNwsUrl(p['@id'])||safeNwsUrl(a.id);
    return `<div class="alert alert-${level}"><h4>${title}</h4><p>${esc(p.areaDesc)}</p><p>${esc(local(p.onset||p.effective,tz))}–${esc(local(p.ends||p.expires,tz))}</p><p>${esc(body)}</p>${href?`<a href="${esc(href)}" target="_blank" rel="noreferrer">Full NWS alert</a>`:''}</div>`;
  }
  // Compact, collapsible version for pages without a Today card (Hourly,
  // Radar), so an active warning is visible wherever someone is looking.
  function alertBannerHTML(alerts,tz){
    if(!alerts.length)return '';
    return `<section class="alert-banner" aria-label="Active NWS alerts">${alerts.map(a=>{
      const p=a.properties,level=alertLevel(p),until=p.ends||p.expires;
      const body=toSentenceCase((p.instruction||p.description||'See NWS alert for instructions.').replace(/\s+/g,' '));
      const href=safeNwsUrl(p['@id'])||safeNwsUrl(a.id);
      return `<details class="alert alert-${level}"><summary><strong>${esc(p.event)}</strong>${until?` <span class="alert-until">until ${esc(local(until,tz))}</span>`:''}</summary><p>${esc(p.areaDesc)}</p><p>${esc(body)}</p>${href?`<a href="${esc(href)}" target="_blank" rel="noreferrer">Full NWS alert</a>`:''}</details>`;
    }).join('')}</section>`;
  }
  async function renderAlertBanner(container,loc,tz){
    if(!container)return;
    try{container.innerHTML=alertBannerHTML(await activeAlerts(loc),tz)}catch{}
  }
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
    if(!hour12())return String(h).padStart(2,'0');
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
  // Gridpoint fallback for Rain %, matching the H/L pattern below: once
  // today's daytime period has passed, NWS stops returning it (and the
  // period-based probabilityOfPrecipitation with it), so the chip would
  // otherwise vanish from today's card for the rest of the day.
  function popForDate(grid,dateKey,tz){const values=grid.properties?.probabilityOfPrecipitation?.values||[];const vals=values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey).map(r=>r.value).filter(v=>v!=null);return vals.length?Math.round(Math.max(...vals)):null}
  // NWS's gridpoint maxTemperature/minTemperature cover the full calendar day
  // regardless of the current time, unlike the text forecast's day/night
  // periods (which disappear once that period ends). Standard practice —
  // matching NWS's own text-forecast generator and apps like Apple Weather —
  // is to fall back to this structured data so a day's high/low still shows
  // after its period has passed, rather than going blank.
  function tempForDate(grid,field,dateKey,tz){const values=grid.properties?.[field]?.values||[];for(const row of values){if(dayKey(tz,row.validTime.split('/')[0])===dateKey&&row.value!=null)return cToF(row.value)}return null}
  const maxTempForDate=(grid,dateKey,tz)=>tempForDate(grid,'maxTemperature',dateKey,tz);
  const minTempForDate=(grid,dateKey,tz)=>tempForDate(grid,'minTemperature',dateKey,tz);
  function gridMetricValuesForDate(grid,fieldName,dateKey,tz,convert=value=>Math.round(value)){
    const field=grid.properties?.[fieldName],values=field?.values||[];
    return values.filter(row=>dayKey(tz,row.validTime.split('/')[0])===dateKey&&row.value!=null).map(row=>convert(row.value,field?.uom)).filter(Number.isFinite);
  }
  function extraDayMetrics(grid,dateKey,tz){
    const asTemperature=(value,uom)=>uom?.includes('degC')?cToF(value):Math.round(value);
    const apparent=gridMetricValuesForDate(grid,'apparentTemperature',dateKey,tz,asTemperature);
    const dewpoints=gridMetricValuesForDate(grid,'dewpoint',dateKey,tz,asTemperature);
    const clouds=gridMetricValuesForDate(grid,'skyCover',dateKey,tz);
    const range=apparent.length?fmtTempRange(Math.min(...apparent),Math.max(...apparent)):null;
    const average=values=>values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
    const dewpoint=average(dewpoints),cloudCover=average(clouds);
    return [
      (range==null||!getShowFeelsLike())?null:['Feels Like',range],
      dewpoint==null?null:['Dew Point',fmtTemp(dewpoint)],
      cloudCover==null?null:['Cloud Cover',`${cloudCover}%`]
    ].filter(Boolean);
  }
  function dayRows(allPeriods,grid,tz,lat){
    // Group by calendar date in the selected display time zone rather than walking
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
    return order.slice(startIdx,startIdx+7).map(key=>({...byKey[key],uv:uvForDate(key,lat),humidity:humidityForDate(grid,key,tz),gust:gustForDate(grid,key,tz),pop:popForDate(grid,key,tz),hi:maxTempForDate(grid,key,tz),lo:minTempForDate(grid,key,tz),extraMetrics:extraDayMetrics(grid,key,tz)}));
  }
  function windAvg(windSpeed){
    const nums=(String(windSpeed).match(/\d+/g)||[]).map(Number);
    if(!nums.length)return null;
    return Math.round(nums.reduce((a,b)=>a+b,0)/nums.length);
  }
  function dayMetrics(d,n,uv,humidity,gridGust,gridHi,gridLo,gridPop){
    const b=d||n;
    const gusts=[d,n].filter(Boolean).map(p=>gustFrom(p.detailedForecast)).filter(v=>v!=null);
    const textGust=gusts.length?Math.max(...gusts):null;
    const gust=gridGust??textGust;
    const pop=d?.probabilityOfPrecipitation?.value??gridPop;
    const wind=windAvg(b.windSpeed);
    // Once today's daytime period has already passed, NWS stops returning it
    // entirely (its periods only run forward from now). Fall back to the
    // gridpoint's maxTemperature/minTemperature — which cover the full
    // calendar day regardless of the current time — so the high still shows
    // after its period has passed, matching how NWS's own forecast text and
    // apps like Apple Weather handle it, instead of going blank.
    const hi=d?.temperature??gridHi;
    const lo=n?.temperature??gridLo;
    const hiLo=hi!=null&&lo!=null?['H',fmtTemp(hi),'L',fmtTemp(lo)]:hi!=null?['H',fmtTemp(hi)]:lo!=null?['L',fmtTemp(lo)]:null;
    return [
      hiLo,
      pop==null?null:['Rain',`${pop}%`],
      humidity==null?null:['Humidity',`${humidity}%`],
      ['Wind',wind==null?b.windSpeed:fmtWind(wind)],
      gust==null?null:['Gusts',fmtWind(gust)],
      uv==null?null:['Max UV',uv]
    ].filter(Boolean);
  }
  let metricsGroupId=0;
  function metricPillsHTML(pairs){return pairs.map(([k,v,k2,v2])=>`<span class="metric"><b>${esc(k)}:</b> ${esc(v)}${k2?` <b>${esc(k2)}:</b> ${esc(v2)}`:''}</span>`).join('')}
  function metricsHTML(pairs,primaryCount=4){
    const primary=pairs.slice(0,primaryCount),extra=pairs.slice(primaryCount);
    if(!extra.length)return `<div class="metric-row">${metricPillsHTML(primary)}</div>`;
    const id=`metrics-extra-${++metricsGroupId}`;
    return `<div class="metric-row">${metricPillsHTML(primary)}</div><button class="metrics-toggle" type="button" aria-expanded="false" aria-controls="${id}" aria-label="Show more weather details"><span>More</span><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5l5-5"/></svg></button><div class="metric-row metrics-extra" id="${id}" hidden>${metricPillsHTML(extra)}</div>`;
  }
  if(typeof document!=='undefined')document.addEventListener('click',event=>{
    const button=event.target.closest?.('.metrics-toggle');
    if(!button)return;
    const extra=document.getElementById(button.getAttribute('aria-controls'));
    if(!extra)return;
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));
    button.setAttribute('aria-label',expanded?'Show more weather details':'Show fewer weather details');
    button.querySelector('span').textContent=expanded?'More':'Less';
    extra.hidden=expanded;
  });
  // Sunrise/sunset equation (Wikipedia "Sunrise equation" / NOAA solar
  // calculator), accurate to within a minute or two — no API, no key,
  // computed entirely from lat/lon/date the way Apple Weather's astro data
  // is, just without needing a bundled library like SunCalc.
  // Takes a 'YYYY-MM-DD' date key (the same shape dayKey()/uvForDate()
  // already use) rather than an arbitrary instant — deliberately, after an
  // earlier version that took a Date here mispredicted which calendar day's
  // sunrise/sunset to return for roughly half of every 24 hours. Julian Day
  // numbers turn over at noon UTC, and the standard sunrise-equation's own
  // rounding epsilon (below) is tuned for a J_date that ISN'T sitting
  // exactly on that boundary, so anchoring at that exact instant (as a
  // date's own UTC noon does) systematically rounds to the wrong day;
  // anchoring at UTC midnight of the target calendar day avoids the
  // boundary entirely and was verified against known sunrise/sunset times
  // across multiple US latitudes/longitudes (including east of the date
  // line, e.g. Guam) before shipping.
  function sunTimes(dateKey,lat,lon){
    const rad=Math.PI/180;
    const toJulian=d=>d.getTime()/86400000+2440587.5;
    const fromJulian=j=>new Date((j-2440587.5)*86400000);
    const J2000=2451545.0;
    const[y,m,d]=dateKey.split('-').map(Number);
    const midnight=new Date(Date.UTC(y,m-1,d));
    const n=Math.ceil(toJulian(midnight)-J2000+0.0008);
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
    const{sunrise,sunset}=sunTimes(dayKey(tz,date),lat,lon);
    const fmt=d=>new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit',hour12:hour12()}).format(d);
    return[sunrise?['Sunrise',fmt(sunrise)]:null,sunset?['Sunset',fmt(sunset)]:null].filter(Boolean);
  }
  // Per-hour version of the same clear-sky estimate uvForDate already uses
  // for the daily "Max UV" metric: scale that day's peak across daylight
  // hours with a sine curve (0 at sunrise/sunset, peak near solar noon).
  // Replaces a live hourly UV feed with no bundled library and no API call.
  function hourlyUVEstimate(date,lat,lon,tz){
    if(lat==null||lon==null)return null;
    const key=dayKey(tz,date);
    const{sunrise,sunset}=sunTimes(key,lat,lon);
    if(!sunrise||!sunset||date<=sunrise||date>=sunset)return 0;
    const dayMax=uvForDate(key,lat);
    if(dayMax==null)return null;
    return Math.max(0,Math.round(dayMax*Math.sin((date-sunrise)/(sunset-sunrise)*Math.PI)));
  }
  // NWS short forecasts are terse Title Case fragments ("Chance Showers And
  // Thunderstorms then Showers And Thunderstorms Likely"). Rewrites them as
  // plain phrases: "showers and thunderstorms possible, then likely",
  // "a slight chance of rain", "patchy fog, then mostly sunny".
  function naturalForecast(text){
    const parts=String(text||'').trim().toLowerCase().split(/\s+then\s+/).filter(Boolean).map(part=>{
      let m=part.match(/^(slight )?chance(?: of)? (.+)$/);
      if(m)return {what:m[2],level:m[1]?'slight':'possible'};
      m=part.match(/^(.+?) likely$/);
      if(m)return {what:m[1],level:'likely'};
      return {what:part,level:null};
    });
    if(!parts.length)return '';
    // Same weather, rising odds: say it once ("… possible, then likely").
    if(parts.length>1&&parts.every(p=>p.what===parts[0].what&&(p.level==='possible'||p.level==='likely')))
      return `${parts[0].what} ${parts.map(p=>p.level).join(', then ')}`;
    return parts.map(p=>p.level==='slight'?`a slight chance of ${p.what}`:p.level==='possible'?`a chance of ${p.what}`:p.level==='likely'?`${p.what} likely`:p.what).join(', then ');
  }
  const capitalize=text=>text?text[0].toUpperCase()+text.slice(1):text;
  // "Mostly sunny with a high near 65°F" / "…, then likely, with a high near
  // 63°F" — the comma keeps a multi-part phrase from running into the number.
  function withTemp(phrase,kind,temp){return `${phrase}${phrase.includes(',')?',':''} with a ${kind} near ${fmtTemp(temp)}`}
  // The italic summary says what the rest of the card doesn't: the headline
  // already shows the main condition and the high/low, and the pills the
  // numbers. So the summary describes how the day turns into the night
  // ("Drying out overnight, mostly clear.", "Clearing overnight.") and adds
  // wind only when it's notable — no repeated temperatures.
  const hasPrecip=text=>/rain|shower|thunder|storm|snow|sleet|drizzle|freezing|ice|flurr/i.test(String(text||''));
  function skyRank(text){
    const t=String(text||'').toLowerCase();
    if(/mostly cloudy/.test(t))return 3;
    if(/cloudy|overcast/.test(t))return /partly/.test(t)?2:4;
    if(/partly/.test(t))return 2;
    if(/mostly (sunny|clear)/.test(t))return 1;
    if(/sunny|clear/.test(t))return 0;
    return 2;
  }
  // "Mostly clear overnight." / "Overnight, showers possible, then likely."
  const timed=(phrase,when)=>phrase.includes(',')?`${capitalize(when)}, ${phrase}.`:`${capitalize(phrase)} ${when}.`;
  function nightSentence(d,n,when){
    if(!n)return '';
    const nn=naturalForecast(n.shortForecast);
    if(!d)return timed(nn,when);
    const nd=naturalForecast(d.shortForecast),pd=hasPrecip(d.shortForecast),pn=hasPrecip(n.shortForecast);
    if(pd&&pn&&nd===nn){
      const kind=precipKind(n.shortForecast),chance=/chance/i.test(n.shortForecast);
      return chance?`${capitalize(kind==='storms'?'storm':kind)} chances continue ${when}.`:`${capitalize(kind)} ${kind==='storms'?'continue':'continues'} ${when}.`;
    }
    if(pd&&pn)return timed(nn,when);
    if(pd)return `Drying out ${when}${nn?`, ${nn}`:''}.`;
    if(pn)return timed(nn,when);
    const rd=skyRank(d.shortForecast),rn=skyRank(n.shortForecast);
    if(rd>=3&&rn<=1)return `Clearing ${when}.`;
    if(rd<=1&&rn>=3)return `Clouds increasing ${when}.`;
    return timed(nn,when);
  }
  const COMPASS={N:'north',NE:'northeast',E:'east',SE:'southeast',S:'south',SW:'southwest',W:'west',NW:'northwest',NNE:'north-northeast',ENE:'east-northeast',ESE:'east-southeast',SSE:'south-southeast',SSW:'south-southwest',WSW:'west-southwest',WNW:'west-northwest',NNW:'north-northwest'};
  function windSentence(p){
    const max=p?maxWind(p.windSpeed):null;
    if(max==null||max<15)return '';
    const dir=COMPASS[String(p.windDirection||'').toUpperCase()];
    return `${max>=25?'Windy':'Breezy'}, with ${dir?`${dir} `:''}winds up to ${fmtWind(max)}.`;
  }
  // Today's bold first line is the live observation, so the summary covers
  // the rest of today and tonight. In the final two hours of the daytime
  // period it covers only tonight, since the daytime forecast is stale.
  function todayBrief(current,d,n,at=new Date(),tz=getTimeZone()){
    const end=d?.endTime?new Date(d.endTime).getTime():NaN;
    const localHour=+new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',hour12:false}).format(at)%24;
    const nearingEvening=Number.isFinite(end)?at.getTime()>=end-2*3600000:localHour>=16;
    const now=current||(d?capitalize(withTemp(naturalForecast(d.shortForecast),'high',d.temperature)):'Conditions unavailable');
    const day=d&&!nearingEvening?`${capitalize(naturalForecast(d.shortForecast))}${naturalForecast(d.shortForecast).includes(',')?',':''} for the rest of the day.`:'';
    const later=[day,nightSentence(d,n,'tonight'),windSentence(day?d:n)].filter(Boolean).join(' ');
    return {now,later};
  }
  function futureBrief(d,n){
    // "Overnight", not "tonight" — these cards are never today, and
    // "tonight" specifically reads as "later today".
    return [nightSentence(d,n,'overnight'),windSentence(d||n)].filter(Boolean).join(' ');
  }
  function futureHeadline(d,n,gridHi=null,gridLo=null){
    const condition=(d||n)?.shortForecast||'Conditions unavailable';
    const hi=d?.temperature??gridHi,lo=n?.temperature??gridLo;
    const range=fmtTempRange(lo,hi);
    return `${condition}${range?` · ${range}`:''}`;
  }
  function renderFutureCardHTML(title,d,n,metrics,gridHi=null,gridLo=null,day=''){
    return `<article class="brief"${day?` data-day="${esc(day)}"`:''}><h3>${esc(title)}</h3><hr><p class="now-line">${esc(futureHeadline(d,n,gridHi,gridLo))}</p>${futureBrief(d,n)?`<p class="condition">${esc(futureBrief(d,n))}</p>`:''}<div class="metrics">${metrics}</div></article>`;
  }
  function renderDaysHTML(rows,tz,loc){
    return rows.map((r,index)=>{
      const d=r.day,n=r.night,b=d||n;
      const date=r.date.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:tz});
      const day=index===0?'Tomorrow':r.date.toLocaleDateString('en-US',{weekday:'long',timeZone:tz});
      const title=`${emoji(b.shortForecast)} ${day} · ${date}`;
      const metrics=metricsHTML([...dayMetrics(d,n,r.uv,r.humidity,r.gust,r.hi,r.lo,r.pop).slice(1),...sunMetrics(r.date,loc?.lat,loc?.lon,tz),...(r.extraMetrics||[])]);
      return renderFutureCardHTML(title,d,n,metrics,r.hi,r.lo,dayKey(tz,r.date));
    }).join('');
  }
  // Shared by the Today page and the 7-day page's first (today) card so the
  // two never drift apart: same brief statement, same metrics, same NWS
  // Alerts section, fetched and rendered by this one function.
  async function loadTodayCard(container,title,loc,point,officeId,todayPeriods,grid,tz){
    const todayKey=dayKey(tz,new Date());
    const metrics=metricsHTML([...dayMetrics(todayPeriods.day,todayPeriods.night,uvForDate(todayKey,loc.lat),humidityForDate(grid,todayKey,tz),gustForDate(grid,todayKey,tz),maxTempForDate(grid,todayKey,tz),minTempForDate(grid,todayKey,tz),popForDate(grid,todayKey,tz)),...sunMetrics(new Date(),loc.lat,loc.lon,tz),...extraDayMetrics(grid,todayKey,tz)]);
    const current=await currentObservation(point).catch(()=>null);
    const currentText=current?currentHeadline(current.observation):null;
    const brief=todayBrief(currentText,todayPeriods.day,todayPeriods.night,new Date(),tz);
    const active=await activeAlerts(loc).catch(()=>[]);
    const laterHTML=brief.later?`<p class="condition">${esc(brief.later)}</p>`:'';
    // Only show the NWS Alerts block when there's a genuine active alert —
    // otherwise this card keeps the exact same shape (brief + metrics, no
    // trailing section) as every other day's card instead of always
    // reserving space for a "No active NWS alerts." line.
    const alertsSectionHTML=active.length?`<hr><h3>NWS Alerts</h3><div id="alerts">${active.map(a=>alertLine(a,tz)).join('')}</div>`:'';
    container.innerHTML=`<article class="brief" data-day="${esc(todayKey)}"><h3>${esc(title)}</h3><hr><p class="now-line">${esc(brief.now)}</p>${laterHTML}<div class="metrics">${metrics}</div>${alertsSectionHTML}</article>`;
    if(!active.length||!officeId)return;
    const hazardText=[todayPeriods.day?.detailedForecast,todayPeriods.night?.detailedForecast].filter(Boolean).join(' ');
    const needsHazard=/thunder|snow|ice|freezing|fog|heavy rain|blizzard/i.test(hazardText)||(gustFrom(hazardText)||0)>20;
    if(needsHazard){
      const [hwo,afd]=await Promise.all([product('HWO',officeId),product('AFD',officeId)]);
      const guidance=[hwo?.productText,afd?.productText].filter(Boolean).join(' ');
      let extra='';
      if(hwo&&/severe|tornado|hail|damaging|blizzard|flood/i.test(guidance))extra+=hwoCardHTML(hwo,officeId,loc,tz);
      if(!hwo||!afd)extra+='<p class="note">Some regional hazard guidance could not be refreshed.</p>';
      if(extra){const slot=container.querySelector('#alerts');if(slot)slot.innerHTML+=extra}
    }
  }

  // ---- Day notes ----------------------------------------------------------
  // Short answers rather than more data — will it rain and when, when is it
  // nicest to be outside, is there a severe-storm risk, what changed since
  // you last looked — each placed inside the card of the day it's about, so
  // the card's own heading says which day. A note only appears when it has
  // something to say.
  const popOf=p=>p?.probabilityOfPrecipitation?.value??0;
  const hourText=(date,tz)=>new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',hour12:hour12()}).format(date);
  function dayName(date,tz){
    const key=dayKey(tz,date),today=dayKey(tz,new Date()),tomorrow=dayKey(tz,new Date(Date.now()+864e5));
    return key===today?'today':key===tomorrow?'tomorrow':new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long'}).format(date);
  }
  const localHour=(date,tz)=>+new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',hour12:false}).format(date)%24;
  // "around 8 PM", "tomorrow around 9 AM"; midnight belongs to the evening
  // before ("until around midnight", not "until tomorrow around 12 AM").
  function whenText(date,tz){
    const h=localHour(date,tz),atMidnight=h===0,labelDate=atMidnight?new Date(date.getTime()-3600000):date;
    const day=dayName(labelDate,tz),time=atMidnight&&hour12()?'midnight':h===12&&hour12()?'noon':hourText(date,tz);
    return `${day==='today'?'':`${day} `}around ${time}`;
  }
  // "2–4 PM" rather than "2 PM–4 PM" when both ends share AM/PM.
  function hourRange(a,b,tz){
    const start=hourText(a,tz),end=hourText(b,tz),m1=start.match(/^(\d+) ([AP]M)$/),m2=end.match(/^(\d+) ([AP]M)$/);
    return m1&&m2&&m1[2]===m2[2]?`${m1[1]}–${end}`:`${start}–${end}`;
  }
  function precipKind(text){const t=String(text).toLowerCase();return /snow|flurr|blizzard/.test(t)?'snow':/sleet|freezing|ice/.test(t)?'wintry mix':/thunder/.test(t)?'storms':'rain'}
  function nextPrecip(hourly,tz){
    const now=Date.now(),hours=(hourly||[]).filter(p=>Date.parse(p.endTime)>now).slice(0,24);
    if(!hours.length)return null;
    const kind=p=>precipKind(p.shortForecast),icon=k=>k==='snow'?'❄️':k==='storms'?'⛈️':'🌧️';
    if(popOf(hours[0])>=50){
      const k=kind(hours[0]),end=hours.findIndex(p=>popOf(p)<30);
      return {icon:icon(k),text:end<0?`${capitalize(k)} likely through the next 24 hours`:`${capitalize(k)} likely until ${whenText(new Date(hours[end].startTime),tz)}`};
    }
    // Rain that starts tomorrow goes on tomorrow's card, where "tomorrow"
    // would be redundant; anything starting today stays on today's.
    const starting=(p,phrase)=>{
      const at=new Date(p.startTime),onTomorrow=dayName(at,tz)==='tomorrow'&&localHour(at,tz)!==0;
      const when=onTomorrow?`around ${localHour(at,tz)===12&&hour12()?'noon':hourText(at,tz)}`:whenText(at,tz);
      return {icon:icon(kind(p)),text:`${phrase} from ${when} (${popOf(p)}%)`,day:onTomorrow?dayKey(tz,new Date(now+864e5)):null};
    };
    const likely=hours.findIndex(p=>popOf(p)>=50);
    if(likely>=0)return starting(hours[likely],`${capitalize(kind(hours[likely]))} likely`);
    const chance=hours.findIndex(p=>popOf(p)>=30);
    if(chance>=0)return starting(hours[chance],`Chance of ${kind(hours[chance])}`);
    return {icon:'🌂',text:'Dry for the next 24 hours'};
  }
  // Scores every two-hour daylight window left today (or tomorrow, once
  // today's are used up) on rain chance, distance from a comfortable
  // 60–75°F, wind, and thunder/snow, and only suggests one that is
  // genuinely decent — no suggestion beats a bad one.
  function bestOutdoorWindow(hourly,loc,tz){
    const now=Date.now(),hours=(hourly||[]).filter(p=>Date.parse(p.endTime)>now).slice(0,48);
    const penalty=p=>{
      const t=p.temperature,w=maxWind(p.windSpeed)||0;
      return Math.max(0,popOf(p)-10)*1.5+(t<60?60-t:t>75?t-75:0)*2+Math.max(0,w-12)*2+(/thunder|snow|sleet|freezing/i.test(p.shortForecast)?40:0);
    };
    const ok=p=>popOf(p)<=30&&p.temperature>=35&&p.temperature<=95&&!/thunder/i.test(p.shortForecast);
    for(const target of [dayKey(tz,new Date()),dayKey(tz,new Date(now+864e5))]){
      const {sunrise,sunset}=sunTimes(target,loc.lat,loc.lon);
      if(!sunrise||!sunset)continue;
      const day=hours.filter(p=>dayKey(tz,p.startTime)===target&&Date.parse(p.startTime)>=sunrise.getTime()-1800000&&Date.parse(p.endTime)<=sunset.getTime()+1800000);
      let best=null;
      for(let i=0;i+1<day.length;i++){
        const pair=[day[i],day[i+1]];
        if(Date.parse(pair[1].startTime)-Date.parse(pair[0].startTime)!==3600000||!pair.every(ok))continue;
        const score=penalty(pair[0])+penalty(pair[1]);
        if(!best||score<best.score)best={score,pair};
      }
      if(best&&best.score<=60){
        const [a,b]=best.pair,temp=Math.round((a.temperature+b.temperature)/2),pop=Math.max(popOf(a),popOf(b)),wind=Math.max(maxWind(a.windSpeed)||0,maxWind(b.windSpeed)||0);
        const details=[fmtTemp(temp),pop<=10?'dry':`${pop}% rain`,wind>20?'windy':wind>12?'breezy':null].filter(Boolean).join(', ');
        return {icon:'🚶',text:`Best time outside: ${hourRange(new Date(a.startTime),new Date(b.endTime),tz)} · ${details}`,day:target};
      }
    }
    return null;
  }
  // "What changed since you last looked": keeps one snapshot per gridpoint
  // in localStorage. The first load of a browsing session pins the previous
  // snapshot as this session's baseline, so refreshes keep comparing against
  // the same earlier forecast instead of the one from ten minutes ago.
  const SNAPSHOT_KEY='weather-forecast-snapshots',SNAPSHOT_BASELINE_KEY='weather-forecast-baseline:';
  function forecastChanges(gridKey,rows,tz){
    const now=Date.now(),todayKey=dayKey(tz,new Date()),days={};
    rows.forEach(r=>{const key=dayKey(tz,r.date);if(key>todayKey)days[key]={hi:r.hi??r.day?.temperature??null,lo:r.lo??r.night?.temperature??null,pop:r.pop??null}});
    let baseline=null;
    try{baseline=JSON.parse(sessionStorage.getItem(SNAPSHOT_BASELINE_KEY+gridKey))}catch{}
    let all={};
    try{all=JSON.parse(localStorage.getItem(SNAPSHOT_KEY))||{}}catch{}
    if(!baseline){baseline=all[gridKey]||{};try{sessionStorage.setItem(SNAPSHOT_BASELINE_KEY+gridKey,JSON.stringify(baseline))}catch{}}
    all[gridKey]={ts:now,days};
    const keys=Object.keys(all).sort((a,b)=>all[b].ts-all[a].ts);
    keys.slice(5).forEach(k=>delete all[k]);
    try{localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(all))}catch{}
    const age=now-(baseline.ts||0);
    if(!baseline.days||age<3600000||age>7*864e5)return new Map();
    const since=new Date(baseline.ts),sinceKey=dayKey(tz,since);
    const sinceText=sinceKey===todayKey?'earlier today':sinceKey===dayKey(tz,new Date(now-864e5))?'yesterday':`${new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long'}).format(since)}`;
    // Returns one note per day that changed meaningfully, keyed by day.
    const notes=new Map();
    for(const [key,cur] of Object.entries(days)){
      const old=baseline.days[key];
      if(!old)continue;
      const changes=[];
      for(const [field,label] of [['hi','High'],['lo','Low']]){
        if(cur[field]==null||old[field]==null)continue;
        const diff=cur[field]-old[field];
        if(Math.abs(diff)>=4)changes.push({weight:Math.abs(diff)/4,text:`${label} ${diff>0?'up':'down'} ${Math.abs(tempValue(cur[field])-tempValue(old[field]))}°`});
      }
      if(cur.pop!=null&&old.pop!=null){
        const diff=cur.pop-old.pop;
        if(Math.abs(diff)>=20&&Math.max(cur.pop,old.pop)>=30)changes.push({weight:Math.abs(diff)/20,text:`Rain chance ${old.pop}% → ${cur.pop}%`});
      }
      if(changes.length)notes.set(key,{icon:'🔄',text:`${changes.sort((a,b)=>b.weight-a.weight).slice(0,2).map(c=>c.text).join(', ')} since ${sinceText}`,day:key});
    }
    return notes;
  }
  // NOAA's own map service for the Storm Prediction Center's convective
  // outlooks. Layer ids are looked up by name from the service metadata
  // rather than hardcoded, and any mismatch just means no line is shown.
  const SPC_SERVICE='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';
  const SPC_LEVELS={MRGL:[1,'Marginal'],SLGT:[2,'Slight'],ENH:[3,'Enhanced'],MDT:[4,'Moderate'],HIGH:[5,'High']};
  const SPC_DN={3:'MRGL',4:'SLGT',5:'ENH',6:'MDT',8:'HIGH'};
  function spcCode(attributes){
    const values=Object.entries(attributes||{});
    for(const [,v] of values){const code=String(v??'').trim().toUpperCase();if(SPC_LEVELS[code])return code}
    const dn=values.find(([k])=>/^dn$/i.test(k));
    return dn?SPC_DN[dn[1]]||null:null;
  }
  async function severeRisk(loc,tz){
    const meta=await json(`${SPC_SERVICE}?f=json`,{ttl:CACHE_TTL.stations});
    // Match on the full group path ("Day 1 Convective Outlook › Categorical"),
    // since the day can live in either the group's name or the layer's own.
    const all=meta.layers||[],byId=new Map(all.map(l=>[l.id,l]));
    const path=l=>{const names=[];for(let x=l;x;x=byId.get(x.parentLayerId))names.unshift(x.name||'');return names.join(' ')};
    const layers=all.filter(l=>!l.subLayerIds?.length).map(l=>({id:l.id,name:path(l)}));
    const notes=[];
    for(const [offset,pattern] of [[0,/day\s*1\b.*categorical/i],[1,/day\s*2\b.*categorical/i]]){
      const layer=layers.find(l=>pattern.test(l.name));
      if(!layer)continue;
      const params=new URLSearchParams({geometry:`${loc.lon},${loc.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false',f:'json'});
      const res=await json(`${SPC_SERVICE}/${layer.id}/query?${params}`,{ttl:30*60000});
      let worst=null;
      for(const f of res.features||[]){
        const code=spcCode(f.attributes);
        if(code&&(!worst||SPC_LEVELS[code][0]>worst[0]))worst=SPC_LEVELS[code];
      }
      if(worst)notes.push({icon:'⚠️',tone:worst[0]>=3?'high':'elevated',text:`${worst[1]} risk of severe storms (${worst[0]} of 5)`,href:'https://www.spc.noaa.gov/products/outlook/',day:dayKey(tz,new Date(Date.now()+offset*864e5))});
    }
    return notes;
  }
  // One short, forecaster-style clause added to a card's summary sentence
  // when the numbers say something worth pointing out: strong gusts, a big
  // day-to-day temperature swing, or the start of a multi-day warming or
  // cooling trend. At most one per card, strongest first.
  function outlookClauses(rows,tz){
    const out=new Map(),todayKey=dayKey(tz,new Date());
    const hi=r=>r?.day?.temperature??r?.hi??null;
    const weekday=date=>new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long'}).format(date);
    const step=i=>i>0&&hi(rows[i])!=null&&hi(rows[i-1])!=null?hi(rows[i])-hi(rows[i-1]):0;
    rows.forEach((r,i)=>{
      const key=dayKey(tz,r.date),options=[];
      if(r.gust!=null&&r.gust>=30)options.push({rank:r.gust>=40?0:3,text:`Gusts to ${fmtWind(r.gust)}.`});
      if(i>0&&key!==todayKey&&step(i)!==0){
        const diff=step(i),prev=rows[i-1],prevName=dayKey(tz,prev.date)===todayKey?'today':weekday(prev.date);
        if(Math.abs(diff)>=10)options.push({rank:1,text:`About ${Math.abs(tempValue(hi(r))-tempValue(hi(prev)))}° ${diff>0?'warmer':'cooler'} than ${prevName}.`});
        // A trend is named once, on the day it starts: three or more days
        // moving the same way, adding up to at least 8°F.
        const dir=Math.sign(diff),startsHere=Math.sign(step(i-1))!==dir||i-1===0&&dayKey(tz,rows[0].date)===todayKey;
        let end=i;
        while(end+1<rows.length&&Math.sign(step(end+1))===dir)end++;
        const total=Math.abs(hi(rows[end])-hi(rows[i-1]));
        if(startsHere&&end-i>=2&&total>=8)options.push({rank:2,text:`${dir>0?'Warming':'Cooling'} trend through ${weekday(rows[end].date)}.`});
      }
      if(options.length)out.set(key,options.sort((a,b)=>a.rank-b.rank)[0].text);
    });
    return out;
  }
  function notesHTML(items){
    return `<ul class="card-notes">${items.map(i=>`<li class="card-note${i.tone?` card-note-${i.tone}`:''}"><span class="card-note-icon" aria-hidden="true">${i.icon}</span><span>${esc(i.text)}${i.href?` <a href="${esc(i.href)}" target="_blank" rel="noreferrer">Details</a>`:''}</span></li>`).join('')}</ul>`;
  }
  // Places notes inside each rendered card (article[data-day]) under its
  // forecast sentence. Notes without a day belong to today. Severe risk
  // comes from a separate NOAA service and is added first when it answers.
  function renderDayNotes(root,{hourly=null,rows,loc,tz,gridKey}){
    if(!root)return;
    for(const [key,text] of outlookClauses(rows,tz)){
      const card=root.querySelector(`article[data-day="${key}"]`),sentence=card?.querySelector('.condition');
      if(sentence)sentence.textContent=`${sentence.textContent} ${text}`;
      else card?.querySelector('.now-line')?.insertAdjacentHTML('afterend',`<p class="condition">${esc(text)}</p>`);
    }
    const todayKey=dayKey(tz,new Date());
    const base=[];
    if(hourly){base.push(nextPrecip(hourly,tz),bestOutdoorWindow(hourly,loc,tz))}
    if(gridKey)base.push(...forecastChanges(gridKey,rows,tz).values());
    const paint=items=>{
      root.querySelectorAll('.card-notes').forEach(n=>n.remove());
      const byDay=new Map();
      items.filter(Boolean).forEach(i=>{const k=i.day||todayKey;if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(i)});
      for(const [key,list] of byDay){
        const card=root.querySelector(`article[data-day="${key}"]`);
        const anchor=card?.querySelector('.condition')||card?.querySelector('.now-line');
        anchor?.insertAdjacentHTML('afterend',notesHTML(list));
      }
    };
    paint(base);
    if(hourly)severeRisk(loc,tz).then(risks=>{if(risks.length)paint([...risks,...base])}).catch(()=>{});
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
          <input id="location-input" type="text" inputmode="search" autocomplete="off" placeholder="City, state or ZIP" aria-label="Search for a location" role="combobox" aria-autocomplete="list" aria-controls="location-suggestions" aria-expanded="false">
          <button class="icon-btn" type="submit" aria-label="Search location">${SEARCH_ICON}</button>
        </div>
        <div class="location-suggestions hidden" id="location-suggestions" role="listbox" aria-label="Location suggestions"></div>
      </form>
      <nav class="tabs" aria-label="Pages">
        <a href="/" class="tab${active==='today'?' active':''}">Today</a>
        <a href="/hourly.html" class="tab${active==='hourly'?' active':''}">Hourly</a>
        <a href="/forecast.html" class="tab${active==='forecast'?' active':''}">7-Day</a>
        <a href="/radar.html" class="tab${active==='radar'?' active':''}">Radar</a>
      </nav>`;
    // Appended directly to <body> because the header's backdrop-filter creates
    // a containing block that would confine fixed navigation to the header.
    if(!el('nav-drawer')){
      document.body.insertAdjacentHTML('beforeend',`
        <div class="nav-scrim" id="nav-scrim" aria-hidden="true"></div>
        <nav class="nav-drawer" id="nav-drawer" aria-label="Site menu" aria-hidden="true">
          <div class="drawer-section">
            <h2 class="drawer-heading">Locations</h2>
            <div id="drawer-locations-content"></div>
          </div>
          <div class="drawer-section">
            <h2 class="drawer-heading">Quick settings</h2>
            <div class="choice-group" role="group" aria-label="Temperature unit" id="drawer-temp-group">
              <button class="choice-btn" type="button" data-choice="F">°F</button>
              <button class="choice-btn" type="button" data-choice="C">°C</button>
            </div>
            <div class="choice-group" role="group" aria-label="Time format" id="drawer-hour-group">
              <button class="choice-btn" type="button" data-choice="12">12h</button>
              <button class="choice-btn" type="button" data-choice="24">24h</button>
            </div>
          </div>
          <a href="/settings.html" data-subpage="settings">Settings</a>
          <a href="/credits.html" class="nav-drawer-bottom" data-subpage="credits">Credits</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </nav>
        <dialog class="nav-subpage" id="nav-subpage" aria-labelledby="nav-subpage-title">
          <div class="nav-subpage-shell">
            <div class="nav-subpage-head">
              <button class="nav-subpage-close" id="nav-subpage-close" type="button" aria-label="Back to weather"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
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
    function paintDrawerLocations(){repaintKeepingFocus(el('drawer-locations-content'),locationSwitcherHTML())}
    paintDrawerLocations();
    wireLocationActions(el('drawer-locations-content'),()=>{setDrawer(false);onLocationChange()});
    document.addEventListener('savedlocationschange',()=>{if(drawerOpen)paintDrawerLocations()});
    // Kept in sync with the identical CHOICE_GROUPS list in settings.html's
    // own script — a smaller, always-visible copy of the same two settings
    // for one-tap access without leaving the current page.
    const DRAWER_CHOICE_GROUPS=[
      {id:'drawer-temp-group',get:getTempUnit,set:setTempUnit},
      {id:'drawer-hour-group',get:getHourFormat,set:setHourFormat}
    ];
    function paintDrawerChoices(){
      DRAWER_CHOICE_GROUPS.forEach(({id,get})=>{
        const current=get();
        el(id).querySelectorAll('.choice-btn').forEach(b=>{
          const on=b.dataset.choice===current;
          b.classList.toggle('active',on);
          b.setAttribute('aria-pressed',String(on));
        });
      });
    }
    paintDrawerChoices();
    DRAWER_CHOICE_GROUPS.forEach(({id,set})=>{
      el(id).querySelectorAll('.choice-btn').forEach(b=>b.addEventListener('click',()=>{set(b.dataset.choice);paintDrawerChoices()}));
    });
    document.addEventListener('unitschange',paintDrawerChoices);
    function setDrawer(open,restoreFocus=true){
      drawerOpen=open;
      if(open){
        const top=`${el('menu-btn').getBoundingClientRect().bottom}px`;
        el('nav-drawer').style.top=top;
        el('nav-scrim').style.top=top;
        paintDrawerLocations();
      }
      el('nav-drawer').classList.toggle('open',open);
      el('nav-scrim').classList.toggle('open',open);
      el('nav-drawer').setAttribute('aria-hidden',String(!open));
      el('menu-btn').setAttribute('aria-expanded',String(open));
      if(open)el('nav-drawer').querySelector('a, button')?.focus();else if(restoreFocus)el('menu-btn').focus();
    }
    el('menu-btn').addEventListener('click',()=>setDrawer(!drawerOpen));
    el('nav-scrim').addEventListener('click',()=>setDrawer(false));
    const subpage=el('nav-subpage'),subpageContent=el('nav-subpage-content');
    let subpageTrigger=null,subpageCloseTimer=null;
    const subpageCache=new Map();
    // Kept in sync with the identical CHOICE_GROUPS list in settings.html's own
    // inline script, since mountHeader's subpage dialog reuses that page's markup.
    const SUBPAGE_CHOICE_GROUPS=[
      {id:'theme-choice-group',get:getThemeChoice,set:setTheme},
      {id:'temp-unit-choice-group',get:getTempUnit,set:setTempUnit},
      {id:'wind-unit-choice-group',get:getWindUnit,set:setWindUnit},
      {id:'hour-format-choice-group',get:getHourFormat,set:setHourFormat},
      {id:'feels-like-choice-group',get:()=>getShowFeelsLike()?'show':'hide',set:v=>setShowFeelsLike(v==='show')},
      {id:'startup-mode-choice-group',get:getStartupMode,set:setStartupMode}
    ];
    function paintSubpageSettings(){
      SUBPAGE_CHOICE_GROUPS.forEach(({id,get})=>{
        const current=get();
        // aria-pressed alongside the class: the blue .active background is
        // the only other cue that a unit/theme is the selected one, which
        // assistive tech and high-contrast modes can't convey.
        subpageContent.querySelectorAll(`#${id} .choice-btn`).forEach(b=>{
          const on=b.dataset.choice===current;
          b.classList.toggle('active',on);
          b.setAttribute('aria-pressed',String(on));
        });
      });
      const select=subpageContent.querySelector('#time-zone-choice'),current=getTimeZone();
      if(select){
        if(!select.options.length)select.innerHTML=timeZoneOptionsHTML();
        if(![...select.options].some(option=>option.value===current))select.add(new Option(timeZoneLabel(current),current),0);
        select.value=current;
      }
      const refreshSelect=subpageContent.querySelector('#refresh-interval-choice');
      if(refreshSelect)refreshSelect.value=String(getRefreshInterval());
    }
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
          paintSubpageSettings();
          SUBPAGE_CHOICE_GROUPS.forEach(({id,set})=>{
            subpageContent.querySelectorAll(`#${id} .choice-btn`).forEach(b=>b.addEventListener('click',()=>{
              set(b.dataset.choice);
              if(id==='theme-choice-group')paintThemeBtn();
              paintSubpageSettings();
            }));
          });
          subpageContent.querySelector('#time-zone-choice')?.addEventListener('change',e=>setTimeZone(e.target.value));
          subpageContent.querySelector('#refresh-interval-choice')?.addEventListener('change',e=>setRefreshInterval(parseInt(e.target.value,10)));
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
    const locationInput=el('location-input'),suggestions=el('location-suggestions');
    let suggestionMap=new Map(),suggestTimer=null,suggestRequest=0,activeSuggestion=-1,suggestAbort=null;
    // Toggles both mechanisms: some pages hide the kicker with the hidden
    // attribute and some with inline display, and clearing only the inline
    // style can't defeat [hidden] — which silently swallowed "Searching…"
    // and location-search errors on the pages using the attribute.
    function setKicker(text){const k=el('kicker');if(k){k.textContent=text;k.hidden=!text;k.style.display=text?'':'none'}}
    function closeSuggestions(){suggestions.classList.add('hidden');suggestions.innerHTML='';locationInput.setAttribute('aria-expanded','false');locationInput.removeAttribute('aria-activedescendant');activeSuggestion=-1}
    function highlightSuggestion(index){
      const options=[...suggestions.querySelectorAll('[role="option"]')];
      if(!options.length)return;
      activeSuggestion=(index+options.length)%options.length;
      options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===activeSuggestion)));
      locationInput.setAttribute('aria-activedescendant',options[activeSuggestion].id);
      options[activeSuggestion].scrollIntoView({block:'nearest'});
    }
    function renderSuggestions(){
      const names=[...suggestionMap.keys()].slice(0,4);
      if(!names.length){closeSuggestions();return}
      suggestions.innerHTML=names.map((name,i)=>`<button class="location-suggestion" id="location-suggestion-${i}" type="button" role="option" aria-selected="false" data-location="${esc(name)}">${esc(name)}</button>`).join('');
      suggestions.classList.remove('hidden');locationInput.setAttribute('aria-expanded','true');activeSuggestion=-1;
    }
    function pick(pos,query){
      saveLocation({...pos,label:null,source:'search',query});
      locationInput.value='';closeSuggestions();suggestionMap.clear();
      locationInput.blur();
      onLocationChange();
    }
    suggestions.addEventListener('pointerdown',e=>{const option=e.target.closest('[data-location]');if(!option)return;e.preventDefault();const query=option.dataset.location;pick(suggestionMap.get(query),query)});
    locationInput.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'&&!suggestions.classList.contains('hidden')){e.preventDefault();highlightSuggestion(activeSuggestion+1)}
      else if(e.key==='ArrowUp'&&!suggestions.classList.contains('hidden')){e.preventDefault();highlightSuggestion(activeSuggestion-1)}
      else if(e.key==='Enter'&&activeSuggestion>=0){e.preventDefault();const option=suggestions.querySelectorAll('[role="option"]')[activeSuggestion],query=option?.dataset.location;if(query)pick(suggestionMap.get(query),query)}
      else if(e.key==='Escape'&&!suggestions.classList.contains('hidden')){e.preventDefault();closeSuggestions()}
    });
    locationInput.addEventListener('input',()=>{
      clearTimeout(suggestTimer);suggestAbort?.abort();suggestAbort=null;
      const request=++suggestRequest,q=locationInput.value.trim();
      closeSuggestions();
      if(q.length<3){suggestionMap.clear();return}
      suggestTimer=setTimeout(async()=>{
        try{
          suggestAbort=new AbortController();
          const features=await geocodePhoton(q,10,suggestAbort.signal);
          if(request!==suggestRequest||q!==locationInput.value.trim())return;
          suggestionMap=new Map();
          features.forEach(f=>{const label=normalizedLabel(f);if(suggestionMap.size<4&&!suggestionMap.has(label))suggestionMap.set(label,photonPosition(f))});
          renderSuggestions();
        }catch{}
      },350);
    });
    locationInput.addEventListener('focus',()=>{if(suggestionMap.size&&locationInput.value.trim().length>=3)renderSuggestions()});
    document.addEventListener('pointerdown',e=>{if(!el('location-form').contains(e.target))closeSuggestions()});
    el('location-form').addEventListener('submit',async e=>{
      e.preventDefault();
      const q=locationInput.value.trim();
      if(!q)return;
      setKicker('Searching…');
      try{pick(suggestionMap.get(q)||await geocodeSearch(q),q)}
      catch(err){setKicker(err instanceof FetchError?(navigator.onLine===false?"You're offline, so location search isn't available.":'Location search is unavailable right now. Try again shortly.'):err.message||'Location search failed')}
    });
    el('locate-btn').addEventListener('click',async()=>{
      setKicker('Locating…');
      try{const pos=await geolocate();saveLocation({...pos,label:null,source:'geo'});onLocationChange()}
      catch{setKicker('Location access denied or unavailable')}
    });
    return {setKicker};
  }

  const STAR_FILLED_ICON='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m12 3 2.6 5.85 6.4.62-4.85 4.3 1.4 6.28L12 16.9l-5.55 3.15 1.4-6.28-4.85-4.3 6.4-.62Z" fill="currentColor"/></svg>';
  const STAR_OUTLINE_ICON='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m12 3 2.6 5.85 6.4.62-4.85 4.3 1.4 6.28L12 16.9l-5.55 3.15 1.4-6.28-4.85-4.3 6.4-.62Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // Shared by the headline popover (mountLocationSwitcher) and the nav
  // drawer's own "Locations" section, so the two never drift apart.
  function locationSwitcherHTML(){
    const current=getCurrentLocation(),saved=isLocationSaved(current);
    const list=getSavedLocations().slice().sort((a,b)=>(b.favorite?1:0)-(a.favorite?1:0));
    const rows=list.length?list.map(loc=>{
      const active=savedLocKey(loc)===savedLocKey(current);
      return `<div class="location-switcher-row${active?' active':''}">
        <button class="location-switcher-favorite" type="button" data-fav-lat="${loc.lat}" data-fav-lon="${loc.lon}" aria-pressed="${!!loc.favorite}" aria-label="${loc.favorite?'Remove favorite':'Set as favorite'}">${loc.favorite?STAR_FILLED_ICON:STAR_OUTLINE_ICON}</button>
        <button class="location-switcher-jump" type="button" role="menuitem" data-jump-lat="${loc.lat}" data-jump-lon="${loc.lon}" data-jump-label="${esc(loc.label)}">${esc(loc.label)}</button>
        <button class="location-switcher-remove" type="button" data-remove-lat="${loc.lat}" data-remove-lon="${loc.lon}" aria-label="Remove ${esc(loc.label)}">&times;</button>
      </div>`;
    }).join(''):'<p class="location-switcher-empty">No saved locations yet. Save this one below, or search for another.</p>';
    return `<button class="location-switcher-save" type="button" data-toggle-save>${saved?`${STAR_FILLED_ICON} Saved — tap to remove`:`${STAR_OUTLINE_ICON} Save this location`}</button><div class="location-switcher-list">${rows}</div>`;
  }
  // Delegated click handling for a location-switcher-HTML container,
  // shared the same way. onJump fires only for a jump-to-location click,
  // since that's the one action the caller needs to react to (closing a
  // panel/drawer, reloading the page's data); the rest are self-contained.
  // Re-rendering the list after Save/Remove/Favorite replaces the button that
  // had focus; put focus back on its replacement (or the Save button, when
  // the row itself was removed) so keyboard users aren't dropped to <body>.
  function repaintKeepingFocus(container,html){
    const active=document.activeElement,hadFocus=container.contains(active);
    let selector=null;
    if(hadFocus){
      if(active.hasAttribute('data-toggle-save'))selector='[data-toggle-save]';
      else if(active.dataset.favLat)selector=`[data-fav-lat="${active.dataset.favLat}"][data-fav-lon="${active.dataset.favLon}"]`;
      else if(active.dataset.jumpLat)selector=`[data-jump-lat="${active.dataset.jumpLat}"][data-jump-lon="${active.dataset.jumpLon}"]`;
    }
    container.innerHTML=html;
    if(hadFocus)(selector&&container.querySelector(selector)||container.querySelector('[data-toggle-save]')||container.querySelector('button'))?.focus();
  }
  function wireLocationActions(container,onJump){
    container.addEventListener('click',e=>{
      if(e.target.closest('[data-toggle-save]')){toggleSavedLocation(getCurrentLocation());return}
      const favBtn=e.target.closest('[data-fav-lat]');
      if(favBtn){toggleFavoriteLocation({lat:+favBtn.dataset.favLat,lon:+favBtn.dataset.favLon});return}
      const removeBtn=e.target.closest('[data-remove-lat]');
      if(removeBtn){removeSavedLocation({lat:+removeBtn.dataset.removeLat,lon:+removeBtn.dataset.removeLon});return}
      const jumpBtn=e.target.closest('[data-jump-lat]');
      if(jumpBtn){
        saveLocation({lat:+jumpBtn.dataset.jumpLat,lon:+jumpBtn.dataset.jumpLon,label:jumpBtn.dataset.jumpLabel,source:'saved'});
        onJump();
      }
    });
  }
  // Makes the page's #headline (each page's own current-location text) act as
  // the entry point for jumping between saved locations, since the headline
  // lives in each page's own markup rather than mountHeader's shared header.
  function mountLocationSwitcher(onLocationChange,triggerId='headline'){
    const headline=el(triggerId);
    if(!headline||headline.dataset.locationSwitcher)return;
    headline.dataset.locationSwitcher='1';
    headline.classList.add('location-switcher-trigger');
    headline.setAttribute('tabindex','0');
    headline.setAttribute('aria-haspopup','menu');
    headline.setAttribute('aria-expanded','false');
    // Deliberately NOT role="button" with an aria-label: this element is the
    // page's only <h1>, and its text is the current location. Overriding the
    // role dropped the page out of heading navigation, and the label replaced
    // the accessible name, so the location itself was never announced — the
    // heading read as "Switch location, button". Keeping the heading intact
    // leaves the location as the name; the hint below explains the action,
    // and lives outside the h1 so page code that rewrites textContent on
    // every load can't clobber it.
    headline.setAttribute('aria-describedby','location-switcher-hint');
    if(!el('location-switcher-panel')){
      document.body.insertAdjacentHTML('beforeend',`
        <span class="sr-only" id="location-switcher-hint">Activate to switch or save locations.</span>
        <div class="nav-scrim" id="location-switcher-scrim" aria-hidden="true"></div>
        <div class="location-switcher-panel" id="location-switcher-panel" role="menu" aria-label="Saved locations" aria-hidden="true"></div>`);
    }
    const panel=el('location-switcher-panel'),scrim=el('location-switcher-scrim');
    let open=false;
    function position(){
      const rect=headline.getBoundingClientRect();
      panel.style.top=`${rect.bottom+6}px`;
      panel.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-panel.offsetWidth-12))}px`;
    }
    function setOpen(next){
      open=next;
      if(open){panel.innerHTML=locationSwitcherHTML();position()}
      panel.classList.toggle('open',open);
      scrim.classList.toggle('open',open);
      panel.setAttribute('aria-hidden',String(!open));
      headline.setAttribute('aria-expanded',String(open));
      if(open)panel.querySelector('button')?.focus();else headline.focus()
    }
    headline.addEventListener('click',()=>setOpen(!open));
    headline.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpen(!open)}});
    scrim.addEventListener('click',()=>setOpen(false));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)setOpen(false)});
    document.addEventListener('savedlocationschange',()=>{if(open){repaintKeepingFocus(panel,locationSwitcherHTML());position()}});
    wireLocationActions(panel,()=>{setOpen(false);onLocationChange()});
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

  // Busy terrain/landuse/building/POI layers compete with radar colors instead
  // of receding behind them. This strips the source style down to only what a
  // radar basemap needs and applies a high-contrast light or dark palette,
  // filtering by the
  // vector tiles' OpenMapTiles source-layer names (stable across whichever
  // cartographic style OpenFreeMap serves them through, unlike its own
  // layer ids). Everything else — landcover, landuse, parks, buildings and
  // POIs — is dropped outright. The full drivable-road hierarchy is retained
  // so local streets progressively appear as the user zooms in, while paths,
  // tracks, service roads and rail lines stay out of the radar presentation.
  function minimalRadarStyle(style,theme='dark'){
    const clone=JSON.parse(JSON.stringify(style));
    const dark=theme!=='light';
    const KEEP_SOURCE_LAYERS=new Set(['water','waterway','boundary','transportation','transportation_name','place']);
    const NON_DRIVING_LAYER=/path|pedestrian|service|track|rail|transit|one.way|road.area/i;
    const MINOR_PLACE=/suburb|neighbourhood|neighborhood|quarter|isolated_dwelling|housenumber/i;
    clone.layers=(clone.layers||[]).filter(l=>{
      if(l.type==='background')return true;
      const sl=l['source-layer'];
      if(!sl||!KEEP_SOURCE_LAYERS.has(sl))return false;
      if(sl==='transportation'||sl==='transportation_name'){
        return !NON_DRIVING_LAYER.test(l.id||'');
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
      if(sl==='boundary'){delete layer.minzoom;delete layer.maxzoom}
      if(layer.type==='background'){layer.paint['background-color']=dark?'#0a0a0a':'#eef4fa';continue}
      if(layer.type==='fill'&&(sl==='water')){layer.paint['fill-color']=dark?'#08121d':'#cce7f4';layer.paint['fill-opacity']=1;delete layer.paint['fill-pattern'];continue}
      if(layer.type==='line'&&sl==='waterway'){layer.paint['line-color']=dark?'#163353':'#8abbd3';layer.paint['line-opacity']=dark ? .75 : .9;continue}
      if(layer.type==='line'&&sl==='boundary'){layer.paint['line-color']=dark?'rgba(185,188,195,0.68)':'rgba(69,88,109,0.72)';layer.paint['line-opacity']=1;if(!layer.paint['line-width'])layer.paint['line-width']=.8;continue}
      if(layer.type==='line'&&sl==='transportation'){
        const id=layer.id||'',blob=JSON.stringify(layer);
        const casing=/casing/i.test(id),major=/motorway|trunk/i.test(blob),primary=/primary/i.test(blob),secondary=/secondary|tertiary/i.test(blob);
        layer.paint['line-color']=dark?(casing?'#090b0e':major?'#1879c9':primary?'#65717d':secondary?'#4d535b':'#35393f'):(casing?'#fff':major?'#1874b9':primary?'#587a98':secondary?'#7890a5':'#a0afbc');
        layer.paint['line-opacity']=/tunnel/i.test(id) ? .58 : casing ? .96 : major ? .98 : primary ? .9 : secondary ? .82 : dark ? .68 : .76;
        continue;
      }
      if(layer.type==='symbol'){
        // Small, low-contrast labels so they read as a quiet reference layer
        // rather than competing with the radar colors for attention. The
        // glyph set itself (whichever font OpenFreeMap's "liberty" style
        // already points at) is left alone: MapLibre labels are pre-rendered
        // SDF glyphs fetched from the style's own glyphs URL, not arbitrary
        // system fonts, so swapping in "SF Pro"/"Inter" here would 404
        // instead of just changing the typeface.
        layer.paint['text-color']=dark?'#b9bbc0':'#263f58';layer.paint['text-halo-color']=dark?'#050506':'#f5f9fc';layer.paint['text-halo-width']=dark?1.35:1.65;
        layer.layout=layer.layout||{};
        layer.layout['text-size']=sl==='place'?12:10.5;
        // Route shields provide crucial road orientation on a radar map. Keep
        // the style's native shield sprite for transportation labels, while
        // place labels remain text-only and visually quiet.
        if(sl==='place'){delete layer.paint['icon-color'];delete layer.layout['icon-image']}
        continue;
      }
    }
    return clone;
  }

  // A persistent, page-agnostic footer: the weather-safety disclaimer every
  // page should carry, plus links to the legal pages. Populates a
  // <footer id="site-footer"></footer> placeholder the same way mountHeader
  // populates #site-header, so it stays a single shared component instead
  // of page-specific duplication.
  function mountFooter(){
    const footer=el('site-footer');
    if(!footer)return;
    footer.innerHTML=`<p class="disclaimer">Weather information on this site is for general informational purposes only and is not a substitute for official guidance. In hazardous weather, always follow instructions from the National Weather Service and your local authorities.</p><nav class="footer-links" aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/credits.html">Credits</a></nav>`;
  }
  // Tells people when they're looking at the built-in default location
  // rather than their own, since the site no longer asks for location on
  // its own. Shared by every data page, including Radar.
  function showLocationNote(loc){
    let note=el('location-note');
    if(!note){document.querySelector('.page-head')?.insertAdjacentHTML('afterend','<p class="location-note hidden" id="location-note"></p>');note=el('location-note')}
    if(!note)return;
    const isDefault=loc?.source==='default';
    note.textContent=isDefault?`Showing ${loc.label}, the default location. Search above, or use the arrow button to see the forecast where you are.`:'';
    note.classList.toggle('hidden',!isDefault);
  }
  // Shared load-state UI for the forecast pages: a first-load error with a
  // Try again button, a banner when a later refresh fails or the device goes
  // offline while older data stays on screen (instead of silently showing it
  // as current), the "NWS forecast updated … · Checked …" line, and a Refresh
  // button for desktop, where pull-to-refresh doesn't exist.
  function mountStatus(reload){
    const updated=el('updated'),error=el('error');
    const row=document.createElement('div');
    row.className='updated-row';
    updated.before(row);row.append(updated);
    row.insertAdjacentHTML('beforeend','<button class="text-btn hidden" type="button" id="refresh-btn">Refresh</button>');
    document.querySelector('.page-head').insertAdjacentHTML('afterend','<div class="status-banner hidden" id="status-banner" role="status"><span id="status-banner-text"></span><button class="text-btn" type="button" id="status-banner-retry">Try again</button></div>');
    const banner=el('status-banner'),bannerText=el('status-banner-text'),refreshBtn=el('refresh-btn');
    let loadedAt=null,loadedTz=null;
    const time=(date,tz)=>new Intl.DateTimeFormat('en-US',{timeZone:tz||getTimeZone(),hour:'numeric',minute:'2-digit',hour12:hour12()}).format(date);
    function manual(){bypassCache();reload()}
    function showBanner(text){bannerText.textContent=text;banner.classList.remove('hidden')}
    refreshBtn.addEventListener('click',manual);
    el('status-banner-retry').addEventListener('click',manual);
    error.addEventListener('click',e=>{if(e.target.closest('[data-retry]'))manual()});
    window.addEventListener('offline',()=>{if(loadedAt)showBanner(`You're offline. Showing the forecast as of ${time(loadedAt,loadedTz)}.`)});
    window.addEventListener('online',()=>reload());
    return {
      loaded({loc,issued,tz}){
        loadedAt=new Date();loadedTz=tz;
        // Time only when NWS issued it today; the date is added otherwise.
        const issuedAt=issued?new Date(issued):null,issuedValid=issuedAt&&Number.isFinite(issuedAt.getTime());
        const issuedText=issuedValid?`Forecast issued ${dayKey(tz,issuedAt)===dayKey(tz,loadedAt)?time(issuedAt,tz):local(issuedAt,tz)} · `:'';
        updated.textContent=`${issuedText}Checked ${time(loadedAt,tz)}`;
        updated.classList.remove('hidden');refreshBtn.classList.remove('hidden');
        banner.classList.add('hidden');error.classList.add('hidden');
        showLocationNote(loc);
      },
      failed(e,loc){
        const message=friendlyError(e);
        if(loadedAt){showBanner(`Couldn't refresh. ${message} Showing the forecast as of ${time(loadedAt,loadedTz)}.`);return}
        el('loading').classList.add('hidden');
        error.innerHTML=`<p>${esc(message)}</p><button class="text-btn" type="button" data-retry>Try again</button>`;
        error.classList.remove('hidden');
        const headline=el('headline');
        if(headline&&headline.textContent==='Locating…')headline.textContent=loc?.label||'Weather unavailable';
        if(loc)showLocationNote(loc);
      }
    };
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
      // #map (radar.html only) owns its own one-finger drag-to-pan; a touch
      // starting there shouldn't also arm the page's pull-to-refresh.
      if(refreshing||document.scrollingElement.scrollTop>0||e.target?.closest?.('#map'))return;
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
        bypassCache();
        try{await onRefresh()}catch{}
        indicator.classList.remove('spinning');
        refreshing=false;
      }
      reset();
    });
  }

  return {API,DEFAULT_LOC,CACHE_TTL,normalizedLabel,renderDayNotes,outlookClauses,naturalForecast,nextPrecip,bestOutdoorWindow,forecastChanges,bypassCache,friendlyError,mountStatus,showLocationNote,activeAlerts,renderAlertBanner,DEFAULT_TIME_ZONE,el,esc,getSavedLocation,saveLocation,getCurrentLocation,getTimeZone,setTimeZone,timeZoneLabel,timeZoneOptionsHTML,geolocate,geocodeSearch,resolveLocation,resolvePoint,json,
    getSavedLocations,isLocationSaved,addSavedLocation,removeSavedLocation,toggleSavedLocation,setFavoriteLocation,clearFavoriteLocation,toggleFavoriteLocation,getFavoriteLocation,mountLocationSwitcher,
    getStartupMode,setStartupMode,
    getTempUnit,setTempUnit,getWindUnit,setWindUnit,getHourFormat,setHourFormat,hour12,tempValue,tempUnitLabel,fmtTemp,fmtTempRange,windValue,windUnitLabel,fmtWind,
    getShowFeelsLike,setShowFeelsLike,getRefreshInterval,setRefreshInterval,scheduleAutoRefresh,
    emoji,local,maxWind,gustFrom,durationMs,gridValues,kphToMph,cToF,product,
    currentObservation,observationHistory,currentHeadline,alertLine,dayKey,startOfDay,hourLabel,dayPartLabel,dayRows,uvForDate,humidityForDate,gustForDate,popForDate,maxTempForDate,minTempForDate,extraDayMetrics,dayMetrics,metricsHTML,
    todayBrief,futureBrief,renderFutureCardHTML,loadTodayCard,sunMetrics,hourlyUVEstimate,
    findTodayPeriods,renderDaysHTML,mountHeader,mountFooter,mountPullToRefresh,getTheme,setTheme,getThemeChoice,recolorStyleDark,minimalRadarStyle};
})();
