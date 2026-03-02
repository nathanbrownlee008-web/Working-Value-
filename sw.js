// Use absolute URLs so this works reliably on Vercel and ensures correct scope.
const CACHE_NAME = "top-daily-tips-v2";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install",(event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE_ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",(event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE_NAME?null:caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",(event)=>{
  const req = event.request;
  if(req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        // Cache same-origin only
        try{
          const url = new URL(req.url);
          if(url.origin === self.location.origin){
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(req, copy));
          }
        }catch(e){}
        return res;
      }).catch(()=>cached);
    })
  );
});
