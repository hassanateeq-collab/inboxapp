import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Conversation, InboxIdentity } from '../types'
import ConversationList from './ConversationList'
import ChatThread from './ChatThread'

// Every column the UI actually renders from v_inbox_conversations (no select('*')).
const CONV_COLS =
  'id, connection_id, wa_phone, display_name, last_message_at, last_message_preview, last_inbound_at, ' +
  'unread_count, status, guest_id, booking_id, room_number, property_id, property_code, property_label, ' +
  'booking_source, booking_name, beds24_booking_id, checkin_status, check_in, check_out, tier'

// Short WebAudio ping for new inbound messages (no asset needed).
function playPing() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'; o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3)
    o.start()
    o.stop(ctx.currentTime + 0.33)
    o.onended = () => ctx.close()
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
  const [identity, setIdentity] = useState<InboxIdentity | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId
  const conversationsRef = useRef<Conversation[]>([])
  conversationsRef.current = conversations
  const subscribedOnceRef = useRef(false)

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
        const n = new Notification(title, { body, tag: 'hamsun-inbox' })
        n.onclick = () => { window.focus(); n.close() }
      }
    } catch { /* ignore */ }
    playPing()
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
        mergeConversation(row)
        // Joined labels (property/booking) live in the view; refetch this row only when linkage moved.
        if (linkageChanged) fetchConversationRow(row.id)
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
          void supabase.from('guest_conversations').update({ unread_count: 0 }).eq('id', convId)
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
  useEffect(() => { document.title = totalUnread > 0 ? `(${totalUnread}) Hamsun Inbox` : 'Hamsun Inbox' }, [totalUnread])

  const propertyOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of conversations) if (c.property_code) map.set(c.property_code, c.property_label || c.property_code)
    return Array.from(map, ([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [conversations])

  const hasStray = useMemo(() => conversations.some((c) => !c.booking_id && !c.room_number), [conversations])

  const filtered = useMemo(() => {
    if (propertyFilter === 'all') return conversations
    if (propertyFilter === 'stray') return conversations.filter((c) => !c.booking_id && !c.room_number)
    return conversations.filter((c) => c.property_code === propertyFilter)
  }, [conversations, propertyFilter])

  const selected = conversations.find((c) => c.id === selectedId) || null

  function openConversation(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
    // Optimistic: clear the badge locally right away; the DB echo re-merges the same value.
    setConversations((prev) => prev.map((c) => (c.id === id && c.unread_count ? { ...c, unread_count: 0 } : c)))
    void supabase.from('guest_conversations').update({ unread_count: 0 }).eq('id', id)
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
    <div className="h-full flex bg-wa-dark text-wa-text overflow-hidden">
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[34%] md:min-w-[330px] md:max-w-[460px] flex-col border-r border-wa-border`}>
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
          hasStray={hasStray}
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
