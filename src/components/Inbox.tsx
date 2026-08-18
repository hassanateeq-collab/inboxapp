import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { matchesArrivalDay, stayStateOf, type Conversation, type InboxIdentity, type RosterEntry, type SortBy, type StayState } from '../types'
import ConversationList from './ConversationList'
import ChatThread from './ChatThread'
import { enablePush, getPushState, syncPush, type PushState } from '../lib/push'

// Every column the UI actually renders from v_inbox_conversations (no select('*')).
const CONV_COLS =
  'id, connection_id, wa_phone, display_name, last_message_at, last_message_preview, last_inbound_at, ' +
  'unread_count, status, guest_id, booking_id, room_number, room_type, property_id, property_code, property_label, ' +
  'booking_source, booking_name, beds24_booking_id, checkin_status, check_in, check_out, tier, ' +
  'last_message_direction, last_message_status, wa_valid, booked_at, last_read_by, last_read_at'

// Long, loud three-tone alarm (~2.5s) — fired on new inbound and repeated every minute
// while anything sits unread, so reception can't miss a message even with the app in the
// background (Hassan 2026-08-14: "it should alert properly so that nothing is missed").
function playAlarm() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const notes = [660, 880, 660, 880, 990]
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = freq
      const t0 = ctx.currentTime + i * 0.5
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45)
      o.start(t0)
      o.stop(t0 + 0.5)
    })
    setTimeout(() => ctx.close().catch(() => {}), notes.length * 500 + 300)
  } catch { /* ignore */ }
}

function sortByLastMessage(list: Conversation[]): Conversation[] {
  return [...list].sort(
    (a, b) => (Date.parse(b.last_message_at || '') || 0) - (Date.parse(a.last_message_at || '') || 0),
  )
}

// Approximate the DB's preview for instant local patching; the echo re-merges the real value.
function previewFor(body: unknown, msgType: unknown): string {
  const b = typeof body === 'string' ? body.trim() : ''
  return b ? b.slice(0, 140) : `[${typeof msgType === 'string' && msgType ? msgType : 'message'}]`
}

export default function Inbox({ session }: { session: Session }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [stayFilter, setStayFilter] = useState<StayState | 'all'>('inhouse')
  // Arriving-tab refinements: arrival day ('all'|'today'|'tomorrow'|ISO date) + number problems.
  const [arrivalDay, setArrivalDay] = useState<string>('all')
  const [numberIssues, setNumberIssues] = useState(false)
  // null = automatic per-tab default: Arriving sorts by newest booking, other tabs unreplied-first.
  const [sortPick, setSortPick] = useState<SortBy | null>(null)
  const [identity, setIdentity] = useState<InboxIdentity | null>(null)
  // Web Push onboarding: banner shows until this device is subscribed (or dismissed).
  const [pushState, setPushState] = useState<PushState | null>(null)
  const [pushBannerDismissed, setPushBannerDismissed] = useState(
    () => sessionStorage.getItem('push_banner_dismissed') === '1',
  )
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    getPushState().then(setPushState)
    syncPush(session.user.id, session.user.email || '')
  }, [session.user.id, session.user.email])

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true)
    const res = await enablePush(session.user.id, session.user.email || '')
    setPushBusy(false)
    setPushState(res.state)
  }, [session.user.id, session.user.email])

  const dismissPushBanner = useCallback(() => {
    sessionStorage.setItem('push_banner_dismissed', '1')
    setPushBannerDismissed(true)
  }, [])
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId
  const conversationsRef = useRef<Conversation[]>([])
  conversationsRef.current = conversations
  const subscribedOnceRef = useRef(false)
  // Short staff handle for the shared read stamp ("ali" from ali@hamsun...).
  const readerName = (session.user.email || 'staff').split('@')[0]
  const readerNameRef = useRef(readerName)
  readerNameRef.current = readerName

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('v_inbox_conversations')
      .select(CONV_COLS)
      .order('last_message_at', { ascending: false, nullsFirst: false })
    const rows = ((data as unknown as Conversation[]) || []).map((c) =>
      c.id === selectedIdRef.current && c.unread_count ? { ...c, unread_count: 0 } : c,
    )
    setConversations(rows)
    setLoaded(true)
  }, [])

  // Merge a (possibly partial) row into local state without refetching the whole view.
  // Idempotent: if nothing effectively changes, the previous state object is kept (no re-render/flicker).
  const mergeConversation = useCallback((row: Partial<Conversation> & { id: string }) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id)
      if (idx < 0) {
        // Only insert full rows (i.e. rows fetched from the view); partial patches wait for the fetch.
        if (typeof row.wa_phone !== 'string') return prev
        const full = { unread_count: 0, ...row } as Conversation
        if (full.id === selectedIdRef.current) full.unread_count = 0
        return sortByLastMessage([...prev, full])
      }
      const merged = { ...prev[idx], ...row }
      if (merged.id === selectedIdRef.current) merged.unread_count = 0
      let changed = false
      for (const k of Object.keys(merged) as (keyof Conversation)[]) {
        if (prev[idx][k] !== merged[k]) { changed = true; break }
      }
      if (!changed) return prev
      const next = prev.slice()
      next[idx] = merged
      return sortByLastMessage(next)
    })
  }, [])

  // Fetch a single conversation row from the view (for joined labels) and merge it.
  const fetchConversationRow = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('v_inbox_conversations')
      .select(CONV_COLS)
      .eq('id', id)
      .maybeSingle()
    if (data) mergeConversation(data as unknown as Conversation)
  }, [mergeConversation])

  useEffect(() => {
    supabase.rpc('get_my_inbox_identity').then(({ data }) => setIdentity((data as InboxIdentity) || null))
  }, [])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  const notify = useCallback((title: string, body: string) => {
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        // requireInteraction keeps the banner on screen until dismissed; renotify re-alerts
        // even though the tag replaces the previous banner instead of stacking.
        const n = new Notification(title, { body, tag: 'hamsun-inbox', requireInteraction: true, renotify: true } as NotificationOptions)
        n.onclick = () => { window.focus(); n.close() }
      }
    } catch { /* ignore */ }
    playAlarm()
  }, [])

  useEffect(() => {
    loadConversations()
    const ch = supabase
      .channel('inbox-conversations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_conversations' }, (payload) => {
        const row: any = payload.new
        if (row?.id) fetchConversationRow(row.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guest_conversations' }, (payload) => {
        const row: any = payload.new
        if (!row?.id) return
        const existing = conversationsRef.current.find((c) => c.id === row.id)
        if (!existing) { fetchConversationRow(row.id); return }
        const linkageChanged =
          existing.booking_id !== row.booking_id ||
          existing.guest_id !== row.guest_id ||
          existing.room_number !== row.room_number ||
          existing.property_id !== row.property_id
        // A "touch" (updated_at bumped, no new message) is the checkout/check-in signal from
        // trg_conversation_checkin_status_touch — the roster state lives in the view, refetch.
        const touchOnly = existing.last_message_at === row.last_message_at
        mergeConversation(row)
        if (linkageChanged || touchOnly) fetchConversationRow(row.id)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_messages' }, (payload) => {
        const m: any = payload.new
        const convId: string | undefined = m?.conversation_id
        if (!convId) return
        const isSelected = convId === selectedIdRef.current
        const existing = conversationsRef.current.find((c) => c.id === convId)
        if (existing) {
          mergeConversation({
            id: convId,
            last_message_at: m.created_at,
            last_message_preview: previewFor(m.body, m.msg_type),
            last_message_direction: m.direction,
            last_message_status: m.status ?? null,
            ...(m.direction === 'inbound' ? { last_inbound_at: m.created_at } : {}),
            unread_count:
              m.direction === 'inbound' && !isSelected
                ? (existing.unread_count || 0) + 1
                : existing.unread_count,
          })
        } else {
          // Message for a conversation we don't have yet: pull just that row from the view.
          fetchConversationRow(convId)
        }
        if (m?.direction === 'inbound' && !isSelected) {
          notify('New WhatsApp message', m?.body ? String(m.body).slice(0, 120) : 'New message')
        }
        if (m?.direction === 'inbound' && isSelected) {
          // The thread is open, so keep the DB read-state at 0 (echo merges the same value: no flicker).
          void supabase.from('guest_conversations')
            .update({ unread_count: 0, last_read_by: readerNameRef.current, last_read_at: new Date().toISOString() })
            .eq('id', convId)
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guest_messages' }, (payload) => {
        // Delivery receipts arrive as UPDATEs; advance the list tick when they hit the newest message.
        const m: any = payload.new
        const convId: string | undefined = m?.conversation_id
        if (!convId || m?.direction !== 'outbound' || !m?.status) return
        const existing = conversationsRef.current.find((c) => c.id === convId)
        if (!existing || existing.last_message_direction !== 'outbound') return
        if (existing.last_message_at && m.created_at >= existing.last_message_at) {
          mergeConversation({ id: convId, last_message_status: m.status })
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Full reload only on reconnect (mount already loaded above).
          if (subscribedOnceRef.current) loadConversations()
          subscribedOnceRef.current = true
        }
      })
    return () => { supabase.removeChannel(ch) }
  }, [loadConversations, notify, mergeConversation, fetchConversationRow])

  const totalUnread = useMemo(() => conversations.reduce((s, c) => s + (c.unread_count || 0), 0), [conversations])

  // Only unread with a RECENT inbound (24h — the reply window) drives the repeating alarm.
  // Older unread keeps its badge but stops re-ringing forever (stale chats were making the
  // alarm sound with "no new messages").
  const alarmUnread = useMemo(() => conversations.reduce((s, c) => {
    if (!c.unread_count) return s
    const t = c.last_inbound_at ? Date.parse(c.last_inbound_at) : 0
    return Date.now() - t < 24 * 3600 * 1000 ? s + c.unread_count : s
  }, 0), [conversations])

  // Repeat-until-opened alarm: while anything actionable is unread, re-sound every 60s and
  // flash the tab title, so a missed first alert can't stay missed. Stops when opened.
  useEffect(() => {
    if (totalUnread === 0) { document.title = 'Hamsun Inbox'; return }
    document.title = `(${totalUnread}) Hamsun Inbox`
    if (alarmUnread === 0) return // stale unread only: keep the badge, no flash or re-ring
    let flip = false
    const flash = setInterval(() => {
      flip = !flip
      document.title = flip ? `🔴 (${totalUnread}) NEW MESSAGE` : `(${totalUnread}) Hamsun Inbox`
    }, 1500)
    const rering = setInterval(async () => {
      // Phones with a suspended realtime socket ring on STALE state — someone
      // else may have read the message minutes ago. Verify against the DB and
      // resync instead of ringing when the unread is already handled.
      try {
        const { data, error } = await supabase
          .from('v_inbox_conversations')
          .select('unread_count, last_inbound_at')
          .gt('unread_count', 0)
        if (!error) {
          const fresh = (data || []).reduce((s: number, c: any) => {
            const t = c.last_inbound_at ? Date.parse(c.last_inbound_at) : 0
            return Date.now() - t < 24 * 3600 * 1000 ? s + (c.unread_count || 0) : s
          }, 0)
          if (fresh === 0) {
            loadConversations() // clears the stale badge and stops the alarm
            return
          }
        }
      } catch { /* offline — fall through and ring on local state */ }
      playAlarm()
      try {
        if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          const n = new Notification(`${alarmUnread} unread WhatsApp message${alarmUnread > 1 ? 's' : ''}`, {
            body: 'Guests are waiting for a reply — open the Hamsun Inbox.',
            tag: 'hamsun-inbox', requireInteraction: true, renotify: true,
          } as NotificationOptions)
          n.onclick = () => { window.focus(); n.close() }
        }
      } catch { /* ignore */ }
    }, 60_000)
    return () => { clearInterval(flash); clearInterval(rering); document.title = 'Hamsun Inbox' }
  }, [totalUnread, alarmUnread, loadConversations])

  // Phones suspend the realtime socket in the background: whenever the app
  // comes back to the foreground, resync immediately so badges and alarms
  // reflect what teammates already handled.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') loadConversations()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadConversations])

  const propertyOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of conversations) if (c.property_code) map.set(c.property_code, c.property_label || c.property_code)
    return Array.from(map, ([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [conversations])

  // Full in-house roster (all branches) so the In-house tab can show rooms with NO WhatsApp
  // connection and WHY (no number / not on WhatsApp / not attached). Refreshes every minute.
  const [roster, setRoster] = useState<RosterEntry[]>([])
  useEffect(() => {
    let active = true
    const load = () => {
      supabase.rpc('pms_messaging_reachability', { p_property_id: null }).then(({ data }) => {
        if (active && Array.isArray(data)) setRoster(data as RosterEntry[])
      })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { active = false; clearInterval(t) }
  }, [])

  // Tap a "Not connected" roster row → create/relink the conversation for the booking's
  // primary number and open it, so staff can fire an approved template right away.
  // Bad numbers come back with a clear reason instead of a dead chat.
  const [gapBusy, setGapBusy] = useState<string | null>(null)
  const [gapError, setGapError] = useState<string | null>(null)
  const startChat = useCallback(async (r: RosterEntry) => {
    setGapError(null)
    setGapBusy(r.booking_id)
    try {
      const { data, error } = await (supabase as any).rpc('pms_start_conversation', { p_booking_id: r.booking_id })
      const res = data as any
      if (error || !res?.ok) {
        setGapError(res?.error || error?.message || 'Could not open a chat for this room.')
        return
      }
      await fetchConversationRow(res.conversation_id)
      selectedIdRef.current = res.conversation_id
      setSelectedId(res.conversation_id)
    } finally {
      setGapBusy(null)
    }
  }, [fetchConversationRow])

  // Bookings that have no conversation yet: in-house = reachability gaps reception must fix;
  // arriving = confirmed guests who have not arrived (Confirmed tab, tap to open a chat).
  const rosterGaps = useMemo(() => {
    const withConv = new Set(conversations.map((c) => c.booking_id).filter(Boolean))
    let gaps = roster.filter((r) => !withConv.has(r.booking_id))
    if (propertyFilter !== 'all') gaps = gaps.filter((r) => r.property_code === propertyFilter)
    const inhouse = gaps.filter((r) => r.stay_state !== 'arriving')
      .sort((a, b) => (a.property_code || '').localeCompare(b.property_code || '') || (a.room_number || '').localeCompare(b.room_number || ''))
    let arriving = gaps.filter((r) => r.stay_state === 'arriving')
      .sort((a, b) =>
        (sortPick ?? 'booked') === 'booked'
          ? (b.booked_at || '').localeCompare(a.booked_at || '')
          : (a.check_in || '').localeCompare(b.check_in || '') || (a.property_code || '').localeCompare(b.property_code || ''))
    arriving = arriving.filter((r) => matchesArrivalDay(r.check_in, arrivalDay))
    if (numberIssues) arriving = arriving.filter((r) => r.invalid_count > 0)
    return { inhouse, arriving }
  }, [roster, conversations, propertyFilter, arrivalDay, numberIssues, sortPick])

  // Per-tab unread counts power the pill badges — a message in any tab is visible from anywhere.
  const unreadByState = useMemo(() => {
    const acc: Record<StayState, number> = { inhouse: 0, arriving: 0, past: 0, unknown: 0 }
    for (const c of conversations) acc[stayStateOf(c)] += c.unread_count || 0
    return acc
  }, [conversations])

  const filtered = useMemo(() => {
    let list = stayFilter === 'all' ? conversations : conversations.filter((c) => stayStateOf(c) === stayFilter)
    if (propertyFilter !== 'all') list = list.filter((c) => c.property_code === propertyFilter)
    if (stayFilter === 'arriving') {
      list = list.filter((c) => matchesArrivalDay(c.check_in, arrivalDay))
      // verified by Meta as not on WhatsApp (guests.whatsapp_valid = false)
      if (numberIssues) list = list.filter((c) => c.wa_valid === false)
    }
    return list
  }, [conversations, propertyFilter, stayFilter, arrivalDay, numberIssues])

  const sortBy: SortBy = sortPick ?? (stayFilter === 'arriving' ? 'booked' : 'unreplied')

  const selected = conversations.find((c) => c.id === selectedId) || null

  function openConversation(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
    // Optimistic: clear the badge locally right away; the DB echo re-merges the same value.
    const hadUnread = (conversationsRef.current.find((c) => c.id === id)?.unread_count || 0) > 0
    setConversations((prev) => prev.map((c) => (c.id === id && c.unread_count ? { ...c, unread_count: 0 } : c)))
    // Read state is shared by design — stamp WHO cleared it so the team can see
    // who picked the message up ("Seen by ali").
    const patch: Record<string, unknown> = { unread_count: 0 }
    if (hadUnread) {
      patch.last_read_by = readerName
      patch.last_read_at = new Date().toISOString()
    }
    void supabase.from('guest_conversations').update(patch).eq('id', id)
  }

  // Escape deselects the open thread on the mobile layout (modal Escape handlers stop propagation first).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (selectedIdRef.current && window.matchMedia('(max-width: 767px)').matches) {
        selectedIdRef.current = null
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-full flex flex-col bg-wa-dark text-wa-text overflow-hidden">
      {!pushBannerDismissed && pushState === 'unsubscribed' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-wa-header border-b border-wa-border text-[13px]">
          <span className="flex-1 leading-snug">
            Get notified on this phone when guests message — even with the app closed.
          </span>
          <button
            onClick={handleEnablePush}
            disabled={pushBusy}
            className="shrink-0 px-3 py-1.5 rounded-full bg-wa-green text-black text-xs font-semibold disabled:opacity-50"
          >
            {pushBusy ? 'Enabling…' : 'Enable notifications'}
          </button>
          <button onClick={dismissPushBanner} className="shrink-0 text-wa-text/60 px-1" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {!pushBannerDismissed && pushState === 'denied' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-wa-header border-b border-wa-border text-[12px] text-wa-text/70">
          <span className="flex-1 leading-snug">
            Notifications are blocked for this app — allow them in your browser/site settings to get message alerts.
          </span>
          <button onClick={dismissPushBanner} className="shrink-0 text-wa-text/60 px-1" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden min-h-0">
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[42%] md:min-w-[380px] md:max-w-[580px] flex-col border-r border-wa-border`}>
        <ConversationList
          conversations={filtered}
          loading={!loaded}
          selectedId={selectedId}
          onSelect={openConversation}
          userEmail={session.user.email || ''}
          onLogout={() => supabase.auth.signOut()}
          propertyOptions={propertyOptions}
          propertyFilter={propertyFilter}
          onFilterChange={setPropertyFilter}
          stayFilter={stayFilter}
          onStayFilterChange={setStayFilter}
          unreadByState={unreadByState}
          sortBy={sortBy}
          onSortChange={setSortPick}
          arrivalDay={arrivalDay}
          onArrivalDayChange={setArrivalDay}
          numberIssues={numberIssues}
          onNumberIssuesChange={setNumberIssues}
          rosterGaps={stayFilter === 'inhouse' ? rosterGaps.inhouse : stayFilter === 'arriving' ? rosterGaps.arriving : []}
          onStartChat={startChat}
          gapBusyId={gapBusy}
          gapError={gapError}
        />
      </div>
      <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
        {selected ? (
          <ChatThread key={selected.id} conversation={selected} identity={identity} onBack={() => { selectedIdRef.current = null; setSelectedId(null) }} />
        ) : (
          <EmptyState />
        )}
      </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 grid place-items-center bg-wa-panel text-center px-6">
      <div>
        <div className="w-20 h-20 rounded-full bg-wa-header grid place-items-center mx-auto mb-4 text-3xl font-bold text-wa-green">H</div>
        <h2 className="text-wa-text text-2xl font-light">Hamsun Inbox</h2>
        <p className="text-wa-muted text-sm mt-2 max-w-sm">Select a conversation to view and reply. New WhatsApp messages appear here in real time.</p>
      </div>
    </div>
  )
}
