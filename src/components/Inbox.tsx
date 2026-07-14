import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Conversation, InboxIdentity } from '../types'
import ConversationList from './ConversationList'
import ChatThread from './ChatThread'

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

export default function Inbox({ session }: { session: Session }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [identity, setIdentity] = useState<InboxIdentity | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('v_inbox_conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
    setConversations((data as Conversation[]) || [])
  }, [])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_conversations' }, loadConversations)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_messages' }, (payload) => {
        const m: any = payload.new
        loadConversations()
        if (m?.direction === 'inbound' && m?.conversation_id !== selectedIdRef.current) {
          notify('New WhatsApp message', m?.body ? String(m.body).slice(0, 120) : 'New message')
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadConversations, notify])

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

  async function openConversation(id: string) {
    setSelectedId(id)
    await supabase.from('guest_conversations').update({ unread_count: 0 }).eq('id', id)
  }

  return (
    <div className="h-full flex bg-wa-dark text-wa-text overflow-hidden">
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[34%] md:min-w-[330px] md:max-w-[460px] flex-col border-r border-wa-border`}>
        <ConversationList
          conversations={filtered}
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
          <ChatThread key={selected.id} conversation={selected} identity={identity} onBack={() => setSelectedId(null)} />
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
