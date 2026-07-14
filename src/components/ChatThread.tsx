import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Conversation, InboxIdentity, Message } from '../types'
import { sourceLabel, digits } from '../lib/labels'
import LinkRoomModal from './LinkRoomModal'

const SIG_KEY = 'hamsun_inbox_signature'

function timeShort(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChatThread({ conversation, identity, onBack }: { conversation: Conversation; identity: InboxIdentity | null; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roomPhones, setRoomPhones] = useState<string[]>([])
  const [sendAll, setSendAll] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [nickname, setNickname] = useState<string>(() => localStorage.getItem(SIG_KEY) || '')
  const endRef = useRef<HTMLDivElement>(null)

  const signature = (nickname || identity?.first_name || identity?.full_name || '').trim()

  useEffect(() => {
    let active = true
    supabase.from('guest_messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: true })
      .then(({ data }) => { if (active) setMessages((data as Message[]) || []) })
    const ch = supabase
      .channel('thread-' + conversation.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => setMessages((prev) => (prev.some((m) => m.id === (payload.new as Message).id) ? prev : [...prev, payload.new as Message])))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guest_messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => setMessages((prev) => prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))))
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [conversation.id])

  // Other WhatsApp-linked guests in the same room (for "send to all in room").
  useEffect(() => {
    if (!conversation.booking_id) { setRoomPhones([]); setSendAll(false); return }
    let active = true
    supabase.from('booking_guests')
      .select('whatsapp_attached, guests(whatsapp_number, phone)')
      .eq('booking_id', conversation.booking_id)
      .eq('whatsapp_attached', true)
      .then(({ data }) => {
        if (!active) return
        const cur = digits(conversation.wa_phone)
        const set = new Set<string>()
        for (const r of (data as any[]) || []) {
          const p = digits(r.guests?.whatsapp_number || r.guests?.phone)
          if (p && p !== cur) set.add(p)
        }
        setRoomPhones(Array.from(set))
      })
    return () => { active = false }
  }, [conversation.booking_id, conversation.wa_phone])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function doSend() {
    const raw = text.trim()
    if (!raw || sending) return
    setSending(true); setError(null)
    const body = signature ? `${raw}\n\n— ${signature}` : raw
    const { data, error } = await supabase.functions.invoke('whatsapp-send', {
      body: { conversation_id: conversation.id, to: conversation.wa_phone, text: body },
    })
    const ok = !(error || (data && (data as any).error))
    if (ok && sendAll && roomPhones.length) {
      for (const p of roomPhones) {
        await supabase.functions.invoke('whatsapp-send', { body: { to: p, text: body } })
      }
    }
    if (!ok) setError((data && (data as any).error) || error?.message || 'Send failed')
    else setText('')
    setSending(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
  }

  function editSignature() {
    const v = window.prompt('Signature added after your messages (your name, or e.g. "Reception"):', signature)
    if (v !== null) { const t = v.trim(); setNickname(t); localStorage.setItem(SIG_KEY, t) }
  }

  const title = conversation.display_name || '+' + conversation.wa_phone
  const linked = !!conversation.room_number

  return (
    <>
      <div className="min-h-14 px-3 py-2 flex items-center gap-3 bg-wa-header shrink-0">
        <button onClick={onBack} className="md:hidden text-wa-muted p-1" aria-label="Back">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="w-10 h-10 rounded-full bg-wa-panel grid place-items-center text-wa-muted font-medium shrink-0">
          {title.replace('+', '').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{title}</div>
          {linked ? (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-wa-muted">
              <span className="text-wa-text">Room {conversation.room_number}</span>
              {conversation.property_label && <span>· {conversation.property_label}</span>}
              {conversation.booking_source && <span className="px-1.5 rounded bg-wa-panel">{sourceLabel(conversation.booking_source)}</span>}
              {conversation.booking_name && <span className="truncate">· {conversation.booking_name}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-wa-muted min-w-0">
              <span className="truncate">+{conversation.wa_phone} · not linked</span>
              <button onClick={() => setLinkOpen(true)} className="text-wa-green hover:underline shrink-0">Link to room</button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-16 py-4 space-y-1.5 wa-chat-bg">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${m.direction === 'outbound' ? 'bg-wa-bubbleOut' : 'bg-wa-bubbleIn'}`}>
              <span className="whitespace-pre-wrap break-words">{m.body || `[${m.msg_type}]`}</span>
              <span className="text-[10px] text-wa-muted ml-2 float-right mt-1.5 select-none">
                {timeShort(m.created_at)}{m.direction === 'outbound' && m.status ? ' · ' + m.status : ''}
              </span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <div className="bg-red-900/60 text-red-200 text-xs px-4 py-2">{error}</div>}

      <div className="bg-wa-header px-3 pt-2 pb-2 safe-b shrink-0">
        <div className="flex items-center justify-between gap-2 text-[11px] text-wa-muted mb-1.5 px-1">
          <button onClick={editSignature} className="hover:text-wa-text truncate">
            Signed as <span className="text-wa-green font-medium">{signature || 'set your name'}</span>
            <span className="underline ml-1">edit</span>
          </button>
          {roomPhones.length > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
              <input type="checkbox" checked={sendAll} onChange={(e) => setSendAll(e.target.checked)} />
              Send to all in room ({roomPhones.length + 1})
            </label>
          )}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message"
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-2xl bg-wa-search text-wa-text outline-none placeholder:text-wa-muted resize-none max-h-32"
          />
          <button onClick={doSend} disabled={sending || !text.trim()}
            className="w-11 h-11 rounded-full bg-wa-green text-black grid place-items-center disabled:opacity-50 shrink-0" aria-label="Send">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        </div>
      </div>

      {linkOpen && (
        <LinkRoomModal
          conversationId={conversation.id}
          conversationLabel={title}
          onClose={() => setLinkOpen(false)}
          onLinked={() => setLinkOpen(false)}
        />
      )}
    </>
  )
}
