// Retires the old "Sky Report" service worker. Phones that installed the old site keep checking /sw.js;
// this version clears its caches, unregisters itself and reloads open tabs so they load the new site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).map(key => caches.delete(key)));
  await self.registration.unregister();
  const tabs = await self.clients.matchAll({ type: 'window' });
  tabs.forEach(tab => tab.navigate(tab.url));
})()));
