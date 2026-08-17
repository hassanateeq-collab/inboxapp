// Hamsun Inbox service worker — v1 (2026-08-18)
// Job 1: make the app installable (standalone PWA).
// Job 2: receive Web Push from the send-push edge function and show
//        WhatsApp-style notifications while the app is closed.
// The in-app alarm (Inbox.tsx) covers the open-and-visible case, so pushes
// are swallowed when a visible client exists to avoid double alerts.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* non-JSON push */ }
  const title = data.title || 'Hamsun Inbox'
  const body = data.body || 'New WhatsApp message from a guest'
  const tag = data.tag || 'hamsun-inbox'

  event.waitUntil((async () => {
    const clis = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visible = clis.some((c) => c.visibilityState === 'visible')
    if (visible) return // staff is looking at the inbox — the in-app alarm handles it
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const clis = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (clis.length > 0) {
      await clis[0].focus()
      return
    }
    await self.clients.openWindow((event.notification.data && event.notification.data.url) || '/')
  })())
})

// A fetch handler (even pass-through) is required by some browsers for the
// install prompt. No caching: the inbox must always be live.
self.addEventListener('fetch', () => {})
