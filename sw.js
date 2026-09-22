const CACHE='rochester-weather-v74';
const SHELL=['/','/index.html','/brief.html','/live.html','/hourly.html','/forecast.html','/radar.html','/credits.html','/settings.html','/privacy.html','/terms.html','/404.html','/manifest.webmanifest','/favicon.svg','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/assets/site.css','/assets/weather-core.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('install',()=>self.skipWaiting());
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
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request))) });
