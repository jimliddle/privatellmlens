// Optional companion to index.html. It caches nothing and handles no requests.
// Its only job is to let Android browsers, which cannot show a notification
// from a page, announce that a reply has finished. index.html works without it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => "focus" in client);
    return open ? open.focus() : self.clients.openWindow("./");
  }));
});
