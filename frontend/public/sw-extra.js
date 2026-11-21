// Extra service worker code, imported by the generated service worker (see `importScripts` in vite.config.ts).
// Clicking a notification brings Echo to the front, or opens it if it was closed.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        await client.focus();
        client.postMessage({ type: 'echo:notification-click', tag: event.notification.tag });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
