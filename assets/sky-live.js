// Live sections for the Today page: an alert banner at the top, and below
// the existing content a 7-day hourly graph mirroring weather.gov's
// graphical forecast, storm totals, recent observations and the forecast
// discussion. Every source is fetched and fails on its own: a failed source
// shows a small "unavailable, retrying" note in its own section and retries
// with backoff, and never blanks the rest of the page. Location comes from
// the page's own load() (see update()), so there is one location mechanism.
window.WXLive = (function(){
  const {API,el,esc,json,local,CACHE_TTL,durationMs,activeAlerts,alertLevel,productTextHTML,tempValue,tempUnitLabel,windValue,windUnitLabel,hour12,bypassCache}=WX;
  const HOUR=3600000,POLL=10*60000;
  const fmtCache=new Map();
  function fmt(tz,opts){const key=tz+JSON.stringify(opts);let f=fmtCache.get(key);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,...opts});fmtCache.set(key,f)}return f}
  const lower=s=>s.replace(/\s?(AM|PM)\b/g,m=>m.trim()[0].toLowerCase());
  const timeText=(ms,tz)=>fmt(tz,{hour:'numeric',minute:'2-digit',hour12:hour12()}).format(ms);
  const hourText=(ms,tz)=>lower(fmt(tz,{hour:'numeric',hour12:hour12()}).format(ms));
  const dayText=(ms,tz)=>fmt(tz,{weekday:'short',month:'numeric',day:'numeric'}).format(ms);
  const localDay=(ms,tz)=>fmt(tz,{year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
  const localHour=(ms,tz)=>+fmt(tz,{hour:'numeric',hourCycle:'h23'}).format(ms)%24;
  // "2:05 pm" for today, "Fri 2:05 pm" otherwise — the small timestamp style.
  function stamp(value,tz){const ms=Date.parse(value);if(!Number.isFinite(ms))return '—';return `${localDay(ms,tz)===localDay(Date.now(),tz)?'':fmt(tz,{weekday:'short'}).format(ms)+' '}${lower(timeText(ms,tz))}`}
  const COMPASS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const compass=deg=>deg==null?'':COMPASS[Math.round(deg/22.5)%16];
  // ---- Units -------------------------------------------------------------
  // Grid and observation values arrive in WMO units; everything is
  // converted to °F / mph / inches first, then to the reader's display
  // units through the same helpers the rest of the site uses.
  function toF(uom){return /degC/.test(uom||'')?v=>v*9/5+32:v=>v}
  function toMph(uom){return /km_h/.test(uom||'')?v=>v*.621371:/m_s/.test(uom||'')?v=>v*2.236936:/kt/.test(uom||'')?v=>v*1.150779:v=>v}
  function toIn(uom){return /:mm$/.test(uom||'')?v=>v/25.4:/:cm$/.test(uom||'')?v=>v/2.54:/:m$/.test(uom||'')?v=>v*39.3701:v=>v}
  // ---- Grid expansion ------------------------------------------------------
  // Each grid row covers an ISO 8601 interval ("…T18:00:00+00:00/PT3H");
  // expand it into one entry per hour it covers.
  function expand(field,convert){
    const map=new Map();
    for(const row of field?.values||[]){
      const [start,dur='PT1H']=row.validTime.split('/'),at=Date.parse(start),count=Math.max(1,Math.round(durationMs(dur)/HOUR));
      for(let k=0;k<count;k++)map.set(at+k*HOUR,row.value==null?null:convert(row.value));
    }
    return map;
  }
  // Amounts (QPF, snow, ice) are totals for the whole interval, so they are
  // kept as periods for the graph and spread evenly across their hours for
  // sums; the storm totals are the sum of those hourly shares.
  function periods(field){
    const convert=toIn(field?.uom);
    return (field?.values||[]).map(row=>{const [start,dur='PT1H']=row.validTime.split('/'),at=Date.parse(start),hours=Math.max(1,Math.round(durationMs(dur)/HOUR));return {start:at,hours,end:at+hours*HOUR,total:row.value==null?0:Math.max(0,convert(row.value))}});
  }
  // The grid "weather" field lists coverage per weather type. weather.gov's
  // graph shows each type in its five categories; the convective and fog
  // coverages map onto the equivalent category.
  const COVERAGE={slight_chance:[1,'SChc'],isolated:[1,'SChc'],patchy:[1,'SChc'],chance:[2,'Chc'],scattered:[2,'Chc'],areas:[2,'Chc'],likely:[3,'Lkly'],numerous:[3,'Lkly'],occasional:[4,'Ocnl'],intermittent:[4,'Ocnl'],periods:[4,'Ocnl'],brief:[4,'Ocnl'],frequent:[4,'Ocnl'],definite:[5,'Def'],widespread:[5,'Def']};
  const CATEGORY_NAMES={SChc:'Slight chance',Chc:'Chance',Lkly:'Likely',Ocnl:'Occasional',Def:'Definite'};
  const WX_TYPES=[
    {key:'rain',label:'Rain',match:['rain','rain_showers','drizzle']},
    {key:'thunder',label:'Thunder',match:['thunderstorms']},
    {key:'snow',label:'Snow',match:['snow','snow_showers']},
    {key:'fzra',label:'Frz rain',match:['freezing_rain','freezing_drizzle']},
    {key:'sleet',label:'Sleet',match:['sleet']},
    {key:'fog',label:'Fog',match:['fog','freezing_fog']}
  ];
  function weatherCategories(value){
    const out={};
    for(const item of value||[]){
      const coverage=COVERAGE[item?.coverage];
      if(!coverage)continue;
      for(const type of WX_TYPES){
        if(!type.match.includes(item.weather))continue;
        if(!out[type.key]||out[type.key].level<coverage[0])out[type.key]={level:coverage[0],cat:coverage[1],raw:String(item.coverage).replace(/_/g,' ')};
      }
    }
    return out;
  }
  function buildGraph(grid,tz){
    const p=grid?.properties||{};
    const f=name=>p[name];
    const temp=expand(f('temperature'),toF(f('temperature')?.uom)),dew=expand(f('dewpoint'),toF(f('dewpoint')?.uom)),
      chill=expand(f('windChill'),toF(f('windChill')?.uom)),heat=expand(f('heatIndex'),toF(f('heatIndex')?.uom)),
      wind=expand(f('windSpeed'),toMph(f('windSpeed')?.uom)),gust=expand(f('windGust'),toMph(f('windGust')?.uom)),dir=expand(f('windDirection'),v=>v),
      sky=expand(f('skyCover'),v=>v),rh=expand(f('relativeHumidity'),v=>v),pop=expand(f('probabilityOfPrecipitation'),v=>v),
      wx=expand(f('weather'),weatherCategories);
    const amounts={qpf:periods(f('quantitativePrecipitation')),snow:periods(f('snowfallAmount')),ice:periods(f('iceAccumulation'))};
    const start=Math.floor(Date.now()/HOUR)*HOUR;
    let last=start;for(const at of temp.keys())if(at>last)last=at;
    const count=Math.min(24*8,Math.round((last-start)/HOUR)+1);
    const hourly={qpf:new Float64Array(count),snow:new Float64Array(count),ice:new Float64Array(count)};
    for(const key of Object.keys(amounts))for(const period of amounts[key]){
      if(!period.total)continue;
      for(let k=0;k<period.hours;k++){const i=(period.start+k*HOUR-start)/HOUR;if(i>=0&&i<count)hourly[key][i]+=period.total/period.hours}
    }
    const hours=Array.from({length:count},(_,i)=>{
      const t=start+i*HOUR,tf=temp.get(t)??null,ws=wind.get(t)??null,wc=chill.get(t)??null,hi=heat.get(t)??null;
      // weather.gov only graphs wind chill at or below 50°F and heat index
      // at or above 80°F; outside those ranges they equal the temperature.
      return {t,lh:localHour(t,tz),day:localDay(t,tz),temp:tf,dew:dew.get(t)??null,
        chill:wc!=null&&tf!=null&&tf<=50&&(ws==null||ws>3)?wc:null,heat:hi!=null&&tf!=null&&tf>=80?hi:null,
        wind:ws,gust:gust.get(t)??null,dir:dir.get(t)??null,sky:sky.get(t)??null,rh:rh.get(t)??null,pop:pop.get(t)??null,
        wx:wx.get(t)||{},qpf:hourly.qpf[i],snow:hourly.snow[i],ice:hourly.ice[i]};
    });
    return {start,count,hours,amounts,tz,updated:p.updateTime||grid?.updateTime||null};
  }
  // ---- Storm totals --------------------------------------------------------
  function stormTotals(g){
    const sum=(key,from,to)=>{let s=0;for(let i=from;i<Math.min(to,g.count);i++)s+=g.hours[i][key];return s};
    const windows=[{label:'24 h',hours:24},{label:'48 h',hours:48},{label:'72 h',hours:72},{label:`All (${Math.round(g.count/24)} d)`,hours:g.count}];
    const rows=[{key:'qpf',label:'Liquid',digits:2},{key:'snow',label:'Snow',digits:1},{key:'ice',label:'Ice',digits:2}]
      .map(r=>({...r,values:windows.map(w=>sum(r.key,0,w.hours))}))
      .filter(r=>r.values.some(v=>+v.toFixed(r.digits)>0));
    const events=[];
    let i=0;
    while(i<g.count&&events.length<3){
      const wet=h=>h.qpf>0||h.snow>0||h.ice>0;
      if(!wet(g.hours[i])){i++;continue}
      const from=i;while(i<g.count&&wet(g.hours[i]))i++;
      events.push({from:g.hours[from].t,to:g.hours[i-1].t+HOUR,qpf:sum('qpf',from,i),snow:sum('snow',from,i),ice:sum('ice',from,i)});
    }
    return {windows,rows,events};
  }
  // ---- Graph rendering -----------------------------------------------------
  // Five separate graphs, like weather.gov's graphical forecast: temperature,
  // wind, percentages, precipitation types and amounts. Each has its own
  // title, legend, axis and time labels, and all of them scroll together.
  // Global x coordinates (hour i starts at i*pph); each graph's track is
  // split into day-long SVG chunks drawn only when scrolled near.
  const HEAD=26,TOP=HEAD+6,PAD=8,CAT_ROW=16,AMT_ROW=22;
  const AMT_ROWS=[{key:'qpf',label:'Liquid',axis:'QPF',cls:'a-qpf',digits:2},{key:'snow',label:'Snow',axis:'Snow',cls:'a-snow',digits:1},{key:'ice',label:'Ice',axis:'Ice',cls:'a-ice',digits:2}];
  function niceDomain(values,minSpan,step){
    const vals=values.filter(v=>v!=null);
    if(!vals.length)return [0,minSpan];
    let lo=Math.floor(Math.min(...vals)/step)*step,hi=Math.ceil(Math.max(...vals)/step)*step;
    if(hi-lo<minSpan)hi=lo+minSpan;
    return [lo,hi];
  }
  function scales(g){
    const t=[];g.hours.forEach(h=>['temp','dew','chill','heat'].forEach(k=>{if(h[k]!=null)t.push(tempValue(h[k]))}));
    const w=[];g.hours.forEach(h=>['wind','gust'].forEach(k=>{if(h[k]!=null)w.push(windValue(h[k]))}));
    const amtMax={};AMT_ROWS.forEach(r=>{amtMax[r.key]=Math.max(0,...g.amounts[r.key].map(p=>p.total))});
    return {temp:niceDomain(t,20,10),wind:[0,Math.max(windValue(20),Math.ceil(Math.max(0,...w)/10)*10)],pct:[0,100],amtMax};
  }
  // Round-number gridlines: every 10° or 20°, every 5 or 10 mph, every 25%.
  const tickCount=([lo,hi])=>{const span=hi-lo;return span===100?4:span/10>6?span/20:span/10<3?span/5:span/10};
  const yOf=(top,h,[lo,hi])=>v=>top+(hi-v)*h/(hi-lo);
  function linePath(g,key,convert,y,pph,i0,i1){
    let d='',on=false;
    for(let i=Math.max(0,i0-1);i<=Math.min(g.count-1,i1+1);i++){
      const v=g.hours[i][key];
      if(v==null){on=false;continue}
      d+=`${on?'L':'M'}${(i*pph).toFixed(1)} ${y(convert(v)).toFixed(1)}`;on=true;
    }
    return d;
  }
  const T=v=>tempValue(v),W=v=>windValue(v),P=v=>v;
  const hline=(out,x0,w,y)=>out.push(`<line class="g-h" x1="${x0}" x2="${x0+w}" y1="${y}" y2="${y}"/>`);
  const axisTicks=(out,dom,n,y,suffix)=>{for(let j=0;j<=n;j++){const v=dom[0]+(dom[1]-dom[0])*j/n;out.push(`<text class="g-ax" x="40" y="${(y(v)+3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}${suffix}</text>`)}};
  // A line graph panel: gridlines at its round-number ticks, then its series.
  function linePanel({key,title,plot,extra=0,series,unit,suffix,legend,readout}){
    return {key,title,height:TOP+plot+extra+PAD,legend,readout,
      axis(out,sc){axisTicks(out,sc[key],tickCount(sc[key]),yOf(TOP,plot,sc[key]),suffix);out.push(`<text class="g-unit" x="2" y="${TOP-4}">${esc(unit())}</text>`);if(this.axisExtra)this.axisExtra(out)},
      draw(out,g,sc,pph,i0,i1,x0,w){
        const dom=sc[key],y=yOf(TOP,plot,dom),n=tickCount(dom);
        for(let j=0;j<=n;j++)hline(out,x0,w,TOP+plot*j/n);
        series.forEach(([k,cls,convert])=>{const d=linePath(g,k,convert,y,pph,i0,i1);if(d)out.push(`<path class="${cls}" d="${d}"/>`)});
        if(this.drawExtra)this.drawExtra(out,g,pph,i0,i1);
      }};
  }
  const deg=()=>`°${tempUnitLabel()}`;
  const tempText=v=>v==null?'—':`${tempValue(v)}${deg()}`,pctText=v=>v==null?'—':`${Math.round(v)}%`,windText=v=>v==null?'—':`${windValue(v)} ${windUnitLabel()}`;
  const WIND_PLOT=76;
  const PANELS=[
    linePanel({key:'temp',title:'Temperature',plot:120,unit:deg,suffix:'°',
      series:[['dew','s-dew',T],['chill','s-chill',T],['heat','s-heat',T],['temp','s-temp',T]],
      legend:[['s-temp','Temperature'],['s-dew','Dew point'],['s-chill','Wind chill'],['s-heat','Heat index']],
      readout:h=>[['Temp',tempText(h.temp)],['Dew pt',tempText(h.dew)],...(h.chill!=null?[['Wind chill',tempText(h.chill)]]:[]),...(h.heat!=null?[['Heat index',tempText(h.heat)]]:[])]}),
    Object.assign(linePanel({key:'wind',title:'Surface wind',plot:WIND_PLOT,extra:18,unit:windUnitLabel,suffix:'',
      series:[['gust','s-gust',W],['wind','s-wind',W]],
      legend:[['s-wind','Sustained'],['s-gust','Gust'],['g-arrow-sw','Direction (arrows point downwind)']],
      readout:h=>[['Wind',h.wind==null?'—':`${compass(h.dir)} ${windText(h.wind)}`.trim()],['Gust',windText(h.gust)]]}),{
      axisExtra(out){out.push(`<text class="g-unit" x="2" y="${TOP+WIND_PLOT+15}">Dir</text>`)},
      // Direction arrows every three hours, pointing downwind.
      drawExtra(out,g,pph,i0,i1){for(let i=i0;i<i1;i++){const h=g.hours[i];if(h.lh%3||h.dir==null)continue;out.push(`<path class="g-arrow" d="M0 -5L3.2 3L0 1.2L-3.2 3Z" transform="translate(${(i*pph).toFixed(1)} ${TOP+WIND_PLOT+11}) rotate(${(h.dir+180)%360})"/>`)}}}),
    linePanel({key:'pct',title:'Sky cover, humidity & precipitation potential',plot:90,unit:()=>'%',suffix:'%',
      series:[['sky','s-sky',P],['rh','s-rh',P],['pop','s-pop',P]],
      legend:[['s-sky','Sky cover'],['s-rh','Relative humidity'],['s-pop','Precipitation potential']],
      readout:h=>[['Sky',pctText(h.sky)],['Humidity',pctText(h.rh)],['Precip',pctText(h.pop)]]}),
    {key:'wx',title:'Chance of precipitation type',height:TOP+WX_TYPES.length*CAT_ROW+PAD,
      legend:[['cat-scale','Bar height: SChc · Chc · Lkly · Ocnl · Def']],
      readout:h=>{const pills=WX_TYPES.filter(t=>h.wx[t.key]).map(t=>{const v=h.wx[t.key];return [t.label,`${CATEGORY_NAMES[v.cat]}${v.raw.toLowerCase()!==CATEGORY_NAMES[v.cat].toLowerCase()?` (${v.raw})`:''}`]});return pills},
      empty:'No rain, snow, thunder, ice or fog this hour',
      axis(out){WX_TYPES.forEach((type,r)=>out.push(`<text class="g-row" x="2" y="${TOP+r*CAT_ROW+12}">${esc(type.label)}</text>`))},
      // A bar per run of the same category, its height the category, and the
      // category label once per run where there's room for it.
      draw(out,g,sc,pph,i0,i1,x0,w){
        for(let r=0;r<=WX_TYPES.length;r++)hline(out,x0,w,TOP+r*CAT_ROW);
        WX_TYPES.forEach((type,r)=>{
          const top=TOP+r*CAT_ROW;
          let runStart=0,run=null;
          const flush=end=>{
            if(!run)return;
            const a=Math.max(runStart,i0),b=Math.min(end,i1),bh=(CAT_ROW-2)*run.level/5;
            if(b>a)out.push(`<rect class="c-${type.key}" x="${(a*pph).toFixed(1)}" y="${(top+CAT_ROW-1-bh).toFixed(1)}" width="${((b-a)*pph).toFixed(1)}" height="${bh.toFixed(1)}"/>`);
            // One label per run, drawn by the chunk holding its middle.
            const mid=(runStart+end)/2;
            if((end-runStart)*pph>=24&&mid>=i0&&mid<i1)out.push(`<text class="g-cat" x="${(mid*pph).toFixed(1)}" y="${top+CAT_ROW-4}" text-anchor="middle">${run.cat}</text>`);
          };
          for(let i=0;i<=g.count;i++){
            const v=i<g.count?g.hours[i].wx[type.key]||null:null;
            if(v?.cat!==run?.cat){flush(i);runStart=i;run=v}
          }
        });
      }},
    {key:'amt',title:'Precipitation amounts (in)',height:TOP+AMT_ROWS.length*AMT_ROW+PAD,
      legend:[['a-qpf','Liquid (QPF)'],['a-snow','Snowfall'],['a-ice','Ice accumulation']],
      readout:(h,g)=>{const pills=[];AMT_ROWS.forEach(row=>{const p=g.amounts[row.key].find(p=>h.t>=p.start&&h.t<p.end);if(p&&p.total>0)pills.push([row.label,`${p.total.toFixed(row.digits)} in / ${p.hours} h`])});return pills},
      empty:'No measurable amount this hour',
      axis(out){AMT_ROWS.forEach((row,r)=>out.push(`<text class="g-row" x="2" y="${TOP+r*AMT_ROW+14}">${esc(row.axis)}</text>`))},
      // One bar per forecast interval, labelled when wide enough.
      draw(out,g,sc,pph,i0,i1,x0,w){
        for(let r=0;r<=AMT_ROWS.length;r++)hline(out,x0,w,TOP+r*AMT_ROW);
        AMT_ROWS.forEach((row,r)=>{
          const top=TOP+r*AMT_ROW,max=sc.amtMax[row.key]||1;
          for(const p of g.amounts[row.key]){
            if(!(p.total>0))continue;
            const a=Math.max(p.start,g.start),b=Math.min(p.end,g.start+g.count*HOUR);
            const xa=(a-g.start)/HOUR*pph,xb=(b-g.start)/HOUR*pph;
            if(xb<=x0||xa>=x0+w)continue;
            const bh=Math.max(2,(AMT_ROW-8)*p.total/max);
            out.push(`<rect class="${row.cls}" x="${(xa+.5).toFixed(1)}" y="${(top+AMT_ROW-1-bh).toFixed(1)}" width="${Math.max(1,xb-xa-1).toFixed(1)}" height="${bh.toFixed(1)}"/>`);
            const label=p.total.toFixed(row.digits);
            if(+label>0&&xb-xa>=label.length*5.6+4)out.push(`<text class="g-amt" x="${((xa+xb)/2).toFixed(1)}" y="${top+9}" text-anchor="middle">${label}</text>`);
          }
        });
      }}
  ];
  function chunkSVG(panel,g,sc,pph,c){
    const i0=c*24,i1=Math.min(g.count,i0+24),x0=i0*pph,w=(i1-i0)*pph,tz=g.tz,out=[],H=panel.height;
    // Time labels and gridlines, repeated on every graph.
    for(let i=i0;i<i1;i++){
      const h=g.hours[i],x=i*pph;
      if(h.lh%6===0)out.push(`<line class="g-v${h.lh===0?' g-day':''}" x1="${x}" x2="${x}" y1="${HEAD-4}" y2="${H-PAD}"/>`,`<text class="g-hr" x="${x+2}" y="${HEAD-6}">${esc(hourText(h.t,tz))}</text>`);
      if(h.lh===0||i===0&&(24-h.lh)*pph>=72)out.push(`<text class="g-dayl" x="${x+2}" y="10">${esc(i===0?'Today':dayText(h.t,tz))}</text>`);
    }
    panel.draw(out,g,sc,pph,i0,i1,x0,w);
    return `<svg class="lg-svg" viewBox="${x0} 0 ${w} ${H}" width="${w}" height="${H}" aria-hidden="true" focusable="false">${out.join('')}</svg>`;
  }
  function axisSVG(panel,sc){
    const out=[];panel.axis(out,sc);
    return `<svg class="lg-axis-svg" viewBox="0 0 44 ${panel.height}" width="44" height="${panel.height}" aria-hidden="true" focusable="false">${out.join('')}</svg>`;
  }
  function readoutHTML(panel,g,i){
    const h=g.hours[i],tz=g.tz,now=Date.now()>=h.t&&Date.now()<h.t+HOUR;
    const when=`${now?'Now · ':''}${fmt(tz,{weekday:'short'}).format(h.t)} ${hourText(h.t,tz)}`;
    const pills=panel.readout(h,g);
    return `<span class="lg-when">${esc(when)}</span>${pills.length?pills.map(([k,v])=>`<span class="metric"><b>${esc(k)}:</b> ${esc(v)}</span>`).join(''):`<span class="note">${esc(panel.empty)}</span>`}`;
  }
  // ---- State ---------------------------------------------------------------
  const blank=()=>({data:null,sig:null,error:null,retry:null,attempt:0});
  const state={ctx:null,locKey:null,forecastTime:null,lastRefresh:0,inflight:null,sources:{alerts:blank(),grid:blank(),obs:blank(),afd:blank()}};
  const pphFor=width=>Math.max(5,width/48); // 48 hours fill the visible width
  let graph=null; // {g,sc,pph,panels:[{panel,scroller,track,observer,readout}],selected,selectedT}
  // ---- Fetchers ------------------------------------------------------------
  const fetchers={
    alerts:ctx=>activeAlerts(ctx.loc),
    // The page's own load() already requested the grid; share that request once.
    grid(ctx){const shared=ctx.gridRequest;ctx.gridRequest=null;return shared||json(ctx.point.properties.forecastGridData,{ttl:CACHE_TTL.forecast})},
    async obs(ctx){
      const stations=await json(ctx.point.properties.observationStations,{ttl:CACHE_TTL.stations});
      const first=stations.features?.[0];
      if(!first?.id)throw new Error('No observation station.');
      // Rounded to five minutes so a quick re-poll can reuse the cached page.
      const since=new Date(Math.floor((Date.now()-24*HOUR)/300000)*300000).toISOString();
      const result=await json(`${first.id}/observations?start=${encodeURIComponent(since)}&limit=500`,{ttl:CACHE_TTL.forecast});
      const readings=(result.features||[]).map(f=>f.properties).filter(p=>p&&Number.isFinite(Date.parse(p.timestamp))).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
      return {station:first.properties?.stationIdentifier||first.id.split('/').pop(),name:first.properties?.name||'',readings};
    },
    async afd(ctx){
      const wfo=ctx.point.properties.gridId||ctx.officeId;
      const list=await json(`${API}/products/types/AFD/locations/${encodeURIComponent(wfo)}`,{ttl:CACHE_TTL.products});
      const item=(list['@graph']||[])[0];
      if(!item?.id)throw new Error('No forecast discussion.');
      return json(/^https:\/\/api\.weather\.gov\//.test(item.id)?item.id:`${API}/products/${encodeURIComponent(item.id)}`,{ttl:CACHE_TTL.products});
    }
  };
  const signatures={
    alerts:list=>list.map(a=>`${a.properties.id}|${a.properties.sent}`).join(','),
    grid:grid=>`${grid?.properties?.updateTime}|${Math.floor(Date.now()/HOUR)}`,
    obs:o=>`${o.station}|${o.readings.length}|${o.readings[0]?.timestamp}`,
    afd:p=>p.id||p.issuanceTime
  };
  // ---- DOM -----------------------------------------------------------------
  function mount(){
    const sections=el('live-sections');
    if(!sections)return api;
    sections.innerHTML=`
      <section class="live-section" aria-labelledby="lg-title"><div class="live-head"><h2 id="lg-title">Hourly graphs · 7 days</h2><p class="last-updated" id="lg-time"></p></div><p class="live-note hidden" id="lg-note" role="status"></p><div class="lg-panels" id="lg-body"><p class="note">Loading grid forecast…</p></div></section>
      <section class="live-section" aria-labelledby="st-title"><div class="live-head"><h2 id="st-title">Storm totals</h2></div><p class="live-note hidden" id="st-note" role="status"></p><div id="st-body"><p class="note">Loading…</p></div></section>
      <section class="live-section" aria-labelledby="ob-title"><div class="live-head"><h2 id="ob-title">Recent observations</h2><p class="last-updated" id="ob-time"></p></div><p class="live-note hidden" id="ob-note" role="status"></p><div id="ob-body"><p class="note">Loading observations…</p></div></section>
      <section class="live-section" aria-labelledby="afd-title"><div class="live-head"><h2 id="afd-title">Forecast discussion</h2><p class="last-updated" id="afd-time"></p></div><p class="live-note hidden" id="afd-note" role="status"></p><div id="afd-body"><p class="note">Loading discussion…</p></div></section>`;
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-state.lastRefresh>30000)refresh()});
    setInterval(tick,60000);
    document.addEventListener('unitschange',rerenderAll);
    document.addEventListener('timezonechange',()=>{if(state.ctx)state.ctx={...state.ctx,tz:WX.getTimeZone()};rerenderAll()});
    new ResizeObserver(()=>{const width=graph?.panels[0].scroller.clientWidth;if(width&&Math.abs(pphFor(width)-graph.pph)>.05)renderGraph()}).observe(sections);
    return api;
  }
  function tick(){
    if(graph)placeNow();
    // A new hour moves the graph's start and the totals' windows.
    const src=state.sources.grid;
    if(src.data&&signatures.grid(src.data)!==src.sig){src.sig=signatures.grid(src.data);renderGrid()}
    if(document.visibilityState==='visible'&&Date.now()-state.lastRefresh>=POLL)refresh();
  }
  function rerenderAll(){
    const s=state.sources;
    if(s.alerts.data)renderAlerts();if(s.grid.data)renderGrid();if(s.obs.data)renderObs();if(s.afd.data)renderAfd();paintTimes();
  }
  // ---- Refresh loop --------------------------------------------------------
  function update(ctx){
    const key=ctx.point?.properties?.forecastGridData||`${ctx.loc.lat},${ctx.loc.lon}`;
    if(key!==state.locKey){
      state.locKey=key;state.forecastTime=null;
      Object.values(state.sources).forEach(s=>clearTimeout(s.retry));
      state.sources={alerts:blank(),grid:blank(),obs:blank(),afd:blank()};
      graph?.observer?.disconnect();graph=null;
      const alerts=el('live-alerts');if(alerts)alerts.innerHTML='';
      ['lg','st','ob','afd'].forEach(id=>{const b=el(`${id}-body`);if(b)b.innerHTML='<p class="note">Loading…</p>';const t=el(`${id}-time`);if(t)t.textContent=''});
    }
    state.ctx=ctx;
    return refresh();
  }
  function setForecastTime(time){state.forecastTime=time;paintTimes()}
  function refresh(){
    if(!state.ctx)return Promise.resolve();
    if(state.inflight)return state.inflight;
    state.lastRefresh=Date.now();
    state.inflight=Promise.all(Object.keys(fetchers).map(runSource)).finally(()=>{state.inflight=null});
    return state.inflight;
  }
  async function runSource(key){
    const ctx=state.ctx,locKey=state.locKey,src=state.sources[key];
    clearTimeout(src.retry);
    try{
      const data=await fetchers[key](ctx);
      if(locKey!==state.locKey)return;
      src.error=null;src.attempt=0;src.data=data;
      const sig=signatures[key](data);
      if(sig!==src.sig){src.sig=sig;renderers[key]()}
    }catch(e){
      if(locKey!==state.locKey)return;
      src.error=e;src.attempt++;
      // 30 s, 1, 2, 4, 8 min, then every 10 min, for this source alone.
      src.retry=setTimeout(()=>{bypassCache();runSource(key)},Math.min(POLL,30000*2**(src.attempt-1)));
    }
    paintNote(key);paintTimes();
  }
  const NOTE_IDS={alerts:['live-alerts-note'],grid:['lg-note','st-note'],obs:['ob-note'],afd:['afd-note']};
  const NOTE_NAMES={alerts:'Alerts',grid:'Grid forecast',obs:'Observations',afd:'Forecast discussion'};
  function paintNote(key){
    const src=state.sources[key];
    const text=src.error?`${NOTE_NAMES[key]} ${src.data?'couldn’t refresh':'unavailable'}, retrying…`:'';
    NOTE_IDS[key].forEach(id=>{
      let note=el(id);
      if(!note&&id==='live-alerts-note'){const host=el('live-alerts');if(!host)return;host.insertAdjacentHTML('afterend','<p class="live-note hidden" id="live-alerts-note" role="status"></p>');note=el(id)}
      if(!note)return;
      note.textContent=text;note.classList.toggle('hidden',!text);
    });
    if(src.error&&!src.data){
      if(key==='grid'){['lg-body','st-body'].forEach(id=>{const b=el(id);if(b)b.innerHTML=''})}
      else{const b=el({obs:'ob-body',afd:'afd-body'}[key]);if(b)b.innerHTML=''}
    }
  }
  function paintTimes(){
    const tz=state.ctx?.tz||WX.getTimeZone(),s=state.sources,parts=[];
    if(state.forecastTime)parts.push(`Forecast ${stamp(state.forecastTime,tz)}`);
    const gridTime=s.grid.data?.properties?.updateTime;if(gridTime)parts.push(`Grid ${stamp(gridTime,tz)}`);
    const obsTime=s.obs.data?.readings?.[0]?.timestamp;if(obsTime)parts.push(`Obs ${stamp(obsTime,tz)}`);
    const afdTime=s.afd.data?.issuanceTime;if(afdTime)parts.push(`Discussion ${stamp(afdTime,tz)}`);
    const line=el('source-times');
    if(line){line.textContent=parts.join(' · ');line.classList.toggle('hidden',!parts.length)}
    const set=(id,text)=>{const n=el(id);if(n)n.textContent=text};
    set('lg-time',gridTime?`Grid updated ${stamp(gridTime,tz)}`:'');
    set('ob-time',obsTime?`${s.obs.data.station} · latest ${stamp(obsTime,tz)}`:'');
    set('afd-time',afdTime?`Issued ${stamp(afdTime,tz)}`:'');
  }
  // ---- Renderers -----------------------------------------------------------
  function renderAlerts(){
    const host=el('live-alerts'),list=state.sources.alerts.data||[],tz=state.ctx.tz;
    if(!host)return;
    const open=new Set([...host.querySelectorAll('details[open]')].map(d=>d.dataset.id));
    host.innerHTML=list.length?`<section class="alert-banner live-alerts" aria-label="Active NWS alerts">${list.map(a=>{
      const p=a.properties,until=p.ends||p.expires,id=esc(p.id||'');
      return `<details class="alert alert-${alertLevel(p)}" data-id="${id}"${open.has(p.id)?' open':''}><summary><strong>${esc(p.event)}</strong>${until?` <span class="alert-until">until ${esc(stamp(until,tz))}</span>`:''}</summary>${p.headline?`<p class="source-headline">${esc(p.headline)}</p>`:''}${p.areaDesc?`<p class="alert-area">${esc(p.areaDesc)}</p>`:''}${p.description?`<h4 class="alert-sub">Description</h4>${productTextHTML(p.description)}`:''}${p.instruction?`<h4 class="alert-sub">Instructions</h4>${productTextHTML(p.instruction)}`:''}<p class="alert-until">${esc([p.senderName,p.expires?`Expires ${local(p.expires,tz)}`:''].filter(Boolean).join(' · '))}</p></details>`;
    }).join('')}</section>`:'';
  }
  function renderGrid(){renderGraph();renderTotals()}
  function renderGraph(){
    const body=el('lg-body'),data=state.sources.grid.data;
    if(!body||!data)return;
    const g=buildGraph(data,state.ctx.tz);
    if(!g.count||!g.hours.some(h=>h.temp!=null)){body.innerHTML='<p class="note">No grid forecast data for this location.</p>';graph=null;return}
    const prevScroll=graph?.panels?.[0]?.scroller?.scrollLeft||0,prevPph=graph?.pph||0,prevSelected=graph?.selectedT??null;
    graph?.panels?.forEach(p=>p.observer.disconnect());
    const days=Math.round(g.count/24);
    body.innerHTML=PANELS.map(panel=>`<figure class="lg-panel" data-panel="${panel.key}"><figcaption><h3 id="lg-${panel.key}-title">${esc(panel.title)}</h3><div class="legend lg-legend" aria-hidden="true">${panel.legend.map(([cls,label])=>`<span><i class="swatch ${cls}"></i>${esc(label)}</span>`).join('')}</div></figcaption><div class="lg-wrap"><div class="lg-axis"></div><div class="lg-scroll" tabindex="0" role="group" aria-roledescription="graph" aria-labelledby="lg-${panel.key}-title" aria-describedby="lg-${panel.key}-readout lg-help"><div class="lg-track"><div class="lg-now" aria-hidden="true"></div><div class="lg-sel" aria-hidden="true"></div></div></div></div><div class="metric-row lg-readout" id="lg-${panel.key}-readout" aria-live="off"></div></figure>`).join('')+`<p class="sr-only" id="lg-help">Next ${days} days by hour. Use the left and right arrow keys to step through hours; tap or hover an hour to read its values. All graphs scroll together.</p>`;
    const sc=scales(g),first=body.querySelector('.lg-scroll'),pph=pphFor(first.clientWidth||320);
    const panels=PANELS.map(panel=>{
      const fig=body.querySelector(`[data-panel="${panel.key}"]`),scroller=fig.querySelector('.lg-scroll'),track=fig.querySelector('.lg-track');
      fig.querySelector('.lg-axis').innerHTML=axisSVG(panel,sc);
      track.style.width=`${g.count*pph}px`;track.style.height=`${panel.height}px`;
      const observer=new IntersectionObserver(entries=>entries.forEach(e=>{
        if(!e.isIntersecting)return;
        e.target.innerHTML=chunkSVG(panel,g,sc,pph,+e.target.dataset.c);observer.unobserve(e.target);
      }),{root:scroller,rootMargin:'0px 100% 0px 100%'});
      for(let c=0;c<Math.ceil(g.count/24);c++){
        const box=document.createElement('div');box.className='lg-chunk';box.dataset.c=c;
        const i0=c*24,i1=Math.min(g.count,i0+24);box.style.left=`${i0*pph}px`;box.style.width=`${(i1-i0)*pph}px`;
        track.appendChild(box);observer.observe(box);
      }
      return {panel,scroller,track,observer,readout:fig.querySelector('.lg-readout')};
    });
    graph={g,sc,pph,panels,selectedT:prevSelected};
    placeNow();
    const keep=prevSelected!=null&&prevSelected>=g.start&&prevSelected<g.start+g.count*HOUR;
    select(keep?(prevSelected-g.start)/HOUR:0);
    if(prevScroll)scrollAll(prevPph?prevScroll*pph/prevPph:prevScroll);
    panels.forEach(p=>wireGraph(p));
    syncScroll(panels.map(p=>p.scroller));
  }
  function scrollAll(x){graph?.panels.forEach(p=>{if(p.scroller.scrollLeft!==x)p.scroller.scrollLeft=x})}
  // The graphs share one time axis: whichever one is being scrolled leads,
  // and the others follow. Only the leader's scroll events are mirrored, so
  // the followers' own scroll events can't feed back into it.
  function syncScroll(scrollers){
    let lead=null,idle=0;
    const claim=s=>()=>{lead=s};
    scrollers.forEach(s=>{
      ['pointerdown','touchstart','wheel','focus'].forEach(type=>s.addEventListener(type,claim(s),{passive:true}));
      s.addEventListener('scroll',()=>{
        if(lead&&lead!==s)return;
        lead=s;
        const x=s.scrollLeft;
        scrollers.forEach(o=>{if(o!==s&&o.scrollLeft!==x)o.scrollLeft=x});
        clearTimeout(idle);idle=setTimeout(()=>{lead=null},180);
      },{passive:true});
    });
  }
  function placeNow(){
    if(!graph)return;
    const {g,pph}=graph,offset=(Date.now()-g.start)/HOUR,show=offset>=0&&offset<=g.count;
    graph.panels.forEach(p=>{const now=p.track.querySelector('.lg-now');now.style.display=show?'':'none';if(show)now.style.transform=`translateX(${(offset*pph).toFixed(1)}px)`});
  }
  // One selected hour across every graph; each graph reads out its own values.
  function select(i,source=null){
    if(!graph)return;
    const {g,pph}=graph;
    i=Math.max(0,Math.min(g.count-1,Math.round(i)));
    graph.selected=i;graph.selectedT=g.hours[i].t;
    graph.panels.forEach(p=>{
      const line=p.track.querySelector('.lg-sel');line.style.transform=`translateX(${(i*pph).toFixed(1)}px)`;line.style.width=`${pph.toFixed(2)}px`;
      p.readout.setAttribute('aria-live',p===source?'polite':'off');
      p.readout.innerHTML=readoutHTML(p.panel,g,i);
    });
  }
  function wireGraph(p){
    const {scroller,track}=p;
    let frame=0;
    const indexAt=clientX=>(clientX-track.getBoundingClientRect().left)/graph.pph;
    scroller.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch')return;
      const x=e.clientX;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>select(Math.floor(indexAt(x))));
    });
    // Touch drags scroll natively; a tap picks the hour.
    scroller.addEventListener('click',e=>select(Math.floor(indexAt(e.clientX)),p));
    scroller.addEventListener('keydown',e=>{
      const step={ArrowRight:1,ArrowLeft:-1,PageDown:6,PageUp:-6}[e.key];
      let i=graph.selected??0;
      if(e.key==='Home')i=0;else if(e.key==='End')i=graph.g.count-1;else if(step)i+=step;else return;
      e.preventDefault();select(i,p);
      const x=graph.selected*graph.pph,view=scroller.clientWidth;
      if(x<scroller.scrollLeft+graph.pph*2||x>scroller.scrollLeft+view-graph.pph*2)scrollAll(Math.max(0,x-view/2));
    });
  }
  function renderTotals(){
    const body=el('st-body'),data=state.sources.grid.data;
    if(!body||!data)return;
    const g=buildGraph(data,state.ctx.tz),tz=g.tz;
    if(!g.count){body.innerHTML='';return}
    const t=stormTotals(g);
    const table=t.rows.length?`<table class="live-table st-table"><caption class="sr-only">Forecast precipitation totals, inches, from the current hour</caption><thead><tr><th scope="col"></th>${t.windows.map(w=>`<th scope="col">${esc(w.label)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr><th scope="row">${esc(r.label)}</th>${r.values.map(v=>`<td>${v.toFixed(r.digits)}″</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="note">No measurable precipitation in the forecast.</p>';
    const when=ms=>`${fmt(tz,{weekday:'short'}).format(ms)} ${hourText(ms,tz)}`;
    const events=t.rows.length?t.events.map(ev=>{
      const parts=[ev.qpf>=.005?`${ev.qpf.toFixed(2)}″ liquid`:'',ev.snow>=.05?`${ev.snow.toFixed(1)}″ snow`:'',ev.ice>=.005?`${ev.ice.toFixed(2)}″ ice`:''].filter(Boolean);
      return parts.length?`<li><strong>${esc(when(ev.from))} – ${esc(when(ev.to))}</strong> · ${esc(parts.join(' · '))}</li>`:'';
    }).join(''):'';
    body.innerHTML=`${table}${events?`<h3 class="live-sub">Precipitation events</h3><ul class="st-events">${events}</ul>`:''}<p class="note">Sums of the hourly amounts in the graph, from the current hour. Periods that cross a window edge count in proportion.</p>`;
  }
  function obsValue(q,convert){const v=q?.value;return v==null?null:convert(q.unitCode)(v)}
  function renderObs(){
    const body=el('ob-body'),data=state.sources.obs.data,tz=state.ctx.tz;
    if(!body||!data)return;
    const showAll=body.dataset.all==='1';
    const readings=data.readings;
    if(!readings.length){body.innerHTML=`<p class="note">No reports from ${esc(data.station)} in the last 24 hours.</p>`;return}
    // One row per clock hour (its latest report) unless all reports are asked for.
    const seen=new Set(),rows=showAll?readings:readings.filter(r=>{const k=Math.floor(Date.parse(r.timestamp)/HOUR);if(seen.has(k))return false;seen.add(k);return true});
    const deg=`°`,wu=windUnitLabel();
    const cells=r=>{
      const t=obsValue(r.temperature,toF),d=obsValue(r.dewpoint,toF),w=obsValue(r.windSpeed,toMph),gu=obsValue(r.windGust,toMph),pa=r.barometricPressure?.value??r.seaLevelPressure?.value,vis=r.visibility?.value;
      const wind=w==null?'—':w<1?'Calm':`${compass(r.windDirection?.value)} ${windValue(w)}${gu!=null?`G${windValue(gu)}`:''}`;
      return `<tr><th scope="row"><time datetime="${esc(r.timestamp)}">${esc(stamp(r.timestamp,tz))}</time><span class="ob-cond">${esc(r.textDescription||'')}</span></th><td>${t==null?'—':tempValue(t)+deg}</td><td>${d==null?'—':tempValue(d)+deg}</td><td>${esc(wind)}</td><td>${pa==null?'—':(pa/3386.389).toFixed(2)}</td><td>${vis==null?'—':+(vis/1609.344).toFixed(vis<16000?1:0)}</td></tr>`;
    };
    const temps=readings.slice().reverse().map(r=>({t:Date.parse(r.timestamp),v:obsValue(r.temperature,toF)})).filter(p=>p.v!=null);
    let spark='';
    if(temps.length>1){
      const lo=Math.min(...temps.map(p=>p.v)),hi=Math.max(...temps.map(p=>p.v)),t0=temps[0].t,t1=temps[temps.length-1].t||t0+1;
      const d=temps.map((p,k)=>`${k?'L':'M'}${((p.t-t0)/(t1-t0||1)*300).toFixed(1)} ${(36-(p.v-lo)/((hi-lo)||1)*32).toFixed(1)}`).join('');
      spark=`<figure class="ob-spark"><svg viewBox="0 -2 300 42" preserveAspectRatio="none" role="img" aria-label="Temperature over the last 24 hours, from ${tempValue(lo)}° to ${tempValue(hi)}°"><path class="s-temp" d="${d}" vector-effect="non-scaling-stroke"/></svg><figcaption class="note">24-hour temperature · low ${tempValue(lo)}°${esc(tempUnitLabel())}, high ${tempValue(hi)}°${esc(tempUnitLabel())}</figcaption></figure>`;
    }
    body.innerHTML=`${spark}<table class="live-table ob-table"><caption class="sr-only">Observations from ${esc(data.station)}${data.name?` (${esc(data.name)})`:''}, newest first</caption><thead><tr><th scope="col">Time</th><th scope="col">Temp</th><th scope="col">Dew</th><th scope="col">Wind ${esc(wu)}</th><th scope="col"><abbr title="Pressure, inches of mercury">inHg</abbr></th><th scope="col"><abbr title="Visibility, miles">Vis mi</abbr></th></tr></thead><tbody>${rows.map(cells).join('')}</tbody></table>${readings.length>rows.length||showAll?`<button class="text-btn" type="button" id="ob-toggle" aria-expanded="${showAll}">${showAll?'Show hourly only':`Show all ${readings.length} reports`}</button>`:''}`;
    el('ob-toggle')?.addEventListener('click',()=>{body.dataset.all=showAll?'':'1';renderObs();el('ob-toggle')?.focus()});
  }
  // AFD text: section headers (".KEY MESSAGES...") stay as headers; hard
  // wraps inside a paragraph are joined so it reflows on a phone, while
  // bullets and indented lists keep their own lines.
  function afdHTML(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n'),out=[];
    // The WMO/office preamble before the first section keeps its own lines.
    let para='',body=false;
    const flush=()=>{if(para){out.push(esc(para));para=''}};
    for(const raw of lines){
      const line=raw.replace(/\s+$/,'');
      if(!line.trim()){flush();out.push('');continue}
      const header=line.match(/^\.([A-Z][A-Z0-9 /&,()'-]*?)\.\.\.(.*)$/);
      if(header){flush();body=true;out.push(`<strong class="afd-h">.${esc(header[1])}...</strong>${header[2]?esc(header[2]):''}`);continue}
      if(!body||/^(&&|\$\$)/.test(line)||/^\s*([-*•]|\d+[.)])\s/.test(line)||/^[A-Z]{2}\.\.\./.test(line)){flush();para=line;continue}
      para=para?`${para} ${line.trim()}`:line;
    }
    flush();
    return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function afdSection(text,pattern){
    const t=String(text||'').replace(/\r/g,'');
    const m=t.match(pattern);if(!m)return null;
    const rest=t.slice(m.index+m[0].length),end=rest.search(/\n\s*&&|\n\.[A-Z][A-Z0-9 /&,()'-]*?\.\.\./);
    return (end>=0?rest.slice(0,end):rest).trim();
  }
  function renderAfd(){
    const body=el('afd-body'),p=state.sources.afd.data;
    if(!body||!p)return;
    const text=p.productText||'';
    const key=afdSection(text,/\n\.KEY MESSAGES[^\n]*?\.\.\./)||null,syn=key?null:afdSection(text,/\n\.(SYNOPSIS|UPDATE|SHORT TERM)[^\n]*?\.\.\./);
    const summary=key??syn;
    const open=body.querySelector('details')?.open;
    body.innerHTML=`${summary?`<h3 class="live-sub">${key?'Key messages':'Synopsis'}</h3><pre class="afd-text">${afdHTML(summary)}</pre>`:''}<details class="afd-full"${open?' open':''}><summary>Full discussion</summary><pre class="afd-text">${afdHTML(text)}</pre></details>`;
  }
  const renderers={alerts:renderAlerts,grid:renderGrid,obs:renderObs,afd:renderAfd};
  const api={mount,update,refresh,setForecastTime,
    // Exposed for the test harness only.
    _internals:{buildGraph,stormTotals,weatherCategories,expand,afdSection,afdHTML}};
  return api;
})();
