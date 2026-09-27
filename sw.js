const CACHE='sky-report-v114';
const SHELL=['/','/index.html','/brief.html','/live.html','/hourly.html','/forecast.html','/radar.html','/credits.html','/settings.html','/privacy.html','/terms.html','/404.html','/manifest.webmanifest','/favicon.svg','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/assets/site.css','/assets/weather-core.js','/assets/sky-live.js'];
const SHELL_PATHS=new Set(SHELL);
// skipWaiting() only after the precache has finished, so a new worker never
// takes over with a half-filled cache. cache:'reload' skips the browser's
// HTTP cache (GitHub Pages lets it keep files ~10 minutes), so a new worker
// never precaches the previous deploy's CSS or scripts.
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting())));
// clients.claim() alone lets the new worker start serving the NEXT
// navigation immediately; it deliberately does not force-navigate already-open
// tabs, since fetch() below is network-first anyway (a still-open tab isn't
// stuck on stale data) and yanking a tab through an unannounced reload could
// interrupt whatever the person was doing on it (e.g. mid-keystroke in the
// location search box).
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(key=>key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
// Network-first for the site's own files. Only successful responses for the
// fixed app-shell paths are stored, so the cache stays bounded and a 404/500
// can never overwrite a good copy. Pages load assets as /assets/x?v=NNN so
// a deploy can't pair new scripts with old CSS; copies are stored under the
// bare path, and query strings are ignored on lookup so e.g.
// /hourly.html?utm=… still works offline. An uncached page falls back to
// the Today page rather than the browser's own network-error screen.
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok&&response.type==='basic'&&SHELL_PATHS.has(url.pathname)&&(!url.search||/^\?v=\d+$/.test(url.search))){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(url.pathname,copy)));
    }
    return response;
  }).catch(async()=>{
    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached)return cached;
    if(request.mode==='navigate')return (await caches.match('/'))||Response.error();
    return Response.error();
  }));
});
