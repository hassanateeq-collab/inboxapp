// Web Push client plumbing (2026-08-18).
// Subscribes this device to push and stores the subscription in
// public.push_subscriptions; the send-push edge function broadcasts to every
// active row when an inbound guest message arrives (guest_messages trigger).
import { supabase } from './supabase'

// VAPID public key — pairs with web_push_private in ai_config (server side).
// Public by design, ships in the bundle like the anon key.
const VAPID_PUBLIC_KEY =
  'BHgZCwXrlmXv0F5-HdMbndn9z1pcALCmOUrjipPC6cDzI6NkGTb5uTPVe4oCut1Yce3VpF048A4AOdDm-I5ciZo'

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch {
    /* registration failure is non-fatal — app still works without push */
  }
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'subscribed' : 'unsubscribed'
  } catch {
    return 'unsubscribed'
  }
}

async function saveSubscription(sub: PushSubscription, userId: string, userEmail: string) {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('bad subscription')
  const { error } = await (supabase as any).from('push_subscriptions').upsert(
    {
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      user_id: userId,
      user_email: userEmail,
      user_agent: navigator.userAgent.slice(0, 300),
      is_active: true,
      failed_count: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

/** Ask permission (if needed), subscribe, and store the subscription. */
export async function enablePush(
  userId: string,
  userEmail: string,
): Promise<{ ok: boolean; state: PushState; error?: string }> {
  if (!pushSupported()) return { ok: false, state: 'unsupported' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, state: perm === 'denied' ? 'denied' : 'unsubscribed' }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }))
    await saveSubscription(sub, userId, userEmail)
    return { ok: true, state: 'subscribed' }
  } catch (e) {
    return { ok: false, state: 'unsubscribed', error: e instanceof Error ? e.message : String(e) }
  }
}

/** Keep an existing subscription fresh in the DB (called once per app load). */
export async function syncPush(userId: string, userEmail: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await saveSubscription(sub, userId, userEmail)
  } catch {
    /* non-fatal */
  }
}
