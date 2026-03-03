// Use absolute URLs so this works reliably on Vercel and ensures correct scope.
// Bump this whenever you deploy so phones don't get stuck on an old cached build.
const CACHE_NAME = "top-daily-tips-v3";
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
  const url = new URL(req.url);

  // Network-first for navigation/HTML so new deployments show up immediately.
  if(req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/"){
    event.respondWith(
      fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(req, copy));
        return res;
      }).catch(()=>caches.match(req))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        // Cache same-origin only
        try{
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
