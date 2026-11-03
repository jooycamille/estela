// Hey Joy's offline worker. Keeps the app and your trip data on your phone so you can read your itinerary, guides,
// checklist, essentials and tickets without a connection. Data is always fetched fresh when your Mac is reachable;
// the saved copy is only used when it isn't. Changes (adding, ticking…) need a connection.

const VERSION = "heyjoy-v2";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SAVED_AT = "X-Joy-Saved-At"; // marks a response that came from the saved copy

// Never saved: live lookups that are useless offline or must be fresh.
const NO_CACHE = [/^\/api\/flights\/lookup/, /^\/api\/lodging\//, /^\/api\/inbox/, /^\/api\/trips\/[^/]+\/inbox/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.svg"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps a copy, stamped with when it was saved. */
async function save(cacheName, request, response) {
  if (!response.ok || response.type === "opaque") return;
  const headers = new Headers(response.headers);
  headers.set(SAVED_AT, new Date().toISOString());
  const body = await response.clone().blob();
  await (await caches.open(cacheName)).put(request, new Response(body, { status: response.status, headers }));
}

/** Fresh from your Mac when possible; the saved copy when it can't be reached (or takes too long with a copy at hand). */
async function networkFirst(request, cacheName, timeoutMs) {
  const cached = await caches.match(request, { cacheName });
  const network = fetch(request).then(async (res) => {
    await save(cacheName, request, res);
    return res;
  });
  network.catch(() => {}); // a late failure after we've answered from the saved copy is fine
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    return (await Promise.race([network, timeout])) ?? cached;
  } catch {
    return cached;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const res = await fetch(request);
  await save(cacheName, request, res);
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // The app page: fresh if possible, else the saved one (it's the same page for every trip).
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          await save(SHELL, new Request("/"), res.clone());
          return res;
        })
        .catch(async () => (await caches.match("/", { cacheName: SHELL })) ?? Response.error()),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (NO_CACHE.some((re) => re.test(url.pathname))) return;
    // Tickets and vouchers never change once stored.
    if (url.pathname.startsWith("/api/attachments/")) return event.respondWith(cacheFirst(request, DATA));
    return event.respondWith(networkFirst(request, DATA, 6000));
  }
  // Build files are fingerprinted, so a saved copy is always right.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) return event.respondWith(cacheFirst(request, SHELL));
  event.respondWith(networkFirst(request, SHELL, 3000));
});

// ---------- Reminders (push notifications) ----------

self.addEventListener("push", (event) => {
  let data = { title: "Hey Joy", body: "", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

// Tapping a reminder opens the trip's checklist (in the open app if there is one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
