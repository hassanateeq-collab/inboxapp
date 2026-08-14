import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { windowInfo, type Conversation, type InboxIdentity, type Message } from '../types'
import { sourceLabel, digits } from '../lib/labels'
import MessageList from './MessageList'

const LinkRoomModal = lazy(() => import('./LinkRoomModal'))
const TemplateSheet = lazy(() => import('./TemplateSheet'))

const SIG_KEY = 'hamsun_inbox_signature'
const PAGE_SIZE = 50
// Every column the thread renders from guest_messages (skips the heavy payload jsonb).
const MSG_COLS = 'id, conversation_id, wa_message_id, direction, sender, msg_type, body, media_url, status, created_at'

// In-memory per-conversation cache so reopening a thread renders instantly (no flash).
const messageCache = new Map<string, Message[]>()
const CACHE_MAX_THREADS = 30
function cacheSet(id: string, msgs: Message[]) {
  if (!messageCache.has(id) && messageCache.size >= CACHE_MAX_THREADS) {
    const oldest = messageCache.keys().next().value
    if (oldest !== undefined) messageCache.delete(oldest)
  }
  messageCache.set(id, msgs)
}

function isTempId(id: string) {
  return id.startsWith('temp-')
}

function newTempId() {
  return 'temp-' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))
}

function toMessage(r: any): Message {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    wa_message_id: r.wa_message_id ?? null,
    direction: r.direction,
    sender: r.sender ?? null,
    msg_type: r.msg_type,
    body: r.body ?? null,
    media_url: r.media_url ?? null,
    status: r.status ?? null,
    created_at: r.created_at,
  }
}

function byCreatedAt(a: Message, b: Message) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

// Reconcile a freshly fetched "latest page" with what's on screen:
// fetched rows win; older already-loaded history is kept; local temp bubbles are kept
// unless the fetch already contains their echo (matched by wamid).
function mergeFetched(prev: Message[], fetched: Message[]): Message[] {
  if (!prev.length) return fetched
  const fetchedIds = new Set(fetched.map((m) => m.id))
  const fetchedWamids = new Set(fetched.map((m) => m.wa_message_id).filter(Boolean))
  const oldestFetched = fetched.length ? fetched[0].created_at : null
  const staleCutoff = Date.now() - 60_000
  const kept: Message[] = []
  for (const m of prev) {
    if (fetchedIds.has(m.id)) continue
    if (isTempId(m.id)) {
      if (m.wa_message_id && fetchedWamids.has(m.wa_message_id)) continue
      // A temp bubble stuck in "sending" (e.g. tab closed mid-send) becomes retryable.
      if (m.status === 'sending' && Date.parse(m.created_at) < staleCutoff) kept.push({ ...m, status: 'failed' })
      else kept.push(m)
      continue
    }
    // Keep already-paginated history that's older than the fetched window.
    if (oldestFetched !== null && m.created_at < oldestFetched) kept.push(m)
  }
  if (!kept.length) return fetched
  return [...kept, ...fetched].sort(byCreatedAt)
}

export default function ChatThread({ conversation, identity, onBack }: { conversation: Conversation; identity: InboxIdentity | null; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>(() => messageCache.get(conversation.id) ?? [])
  const [loading, setLoading] = useState<boolean>(() => !messageCache.has(conversation.id))
  const [hasMore, setHasMore] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [roomPhones, setRoomPhones] = useState<string[]>([])
  const [sendAll, setSendAll] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [nickname, setNickname] = useState<string>(() => localStorage.getItem(SIG_KEY) || '')

  // 24h window state, re-derived every 30s so the countdown chip stays honest.
  const [windowTick, setWindowTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setWindowTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  void windowTick
  const win = windowInfo(conversation)

  const signature = (nickname || identity?.first_name || identity?.full_name || '').trim()

  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  const loadingOlderRef = useRef(false)
  const signatureRef = useRef(signature)
  signatureRef.current = signature
  const sendAllRef = useRef(sendAll)
  sendAllRef.current = sendAll
  const roomPhonesRef = useRef(roomPhones)
  roomPhonesRef.current = roomPhones

  // Keep the module cache in sync so the next open of this thread is instant.
  useEffect(() => { cacheSet(conversation.id, messages) }, [conversation.id, messages])

  // Info strips (e.g. "delivered as template") clear themselves.
  useEffect(() => {
    if (!info) return
    const t = setTimeout(() => setInfo(null), 7000)
    return () => clearTimeout(t)
  }, [info])

  // WhatsApp parity: when staff have the thread open, relay a read receipt for the newest
  // inbound message so the guest sees blue ticks. Once per wamid.
  const markedReadRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (document.visibilityState !== 'visible') return
    const latestInbound = [...messages].reverse().find((m) => m.direction === 'inbound' && m.wa_message_id)
    const wamid = latestInbound?.wa_message_id
    if (!wamid || markedReadRef.current.has(wamid)) return
    markedReadRef.current.add(wamid)
    void supabase.functions.invoke('whatsapp-send', { body: { action: 'mark_read', message_id: wamid } }).catch(() => {})
  }, [messages])

  // Initial load (latest page, newest-first then reversed) + realtime for this thread.
  useEffect(() => {
    let active = true
    supabase
      .from('guest_messages')
      .select(MSG_COLS)
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data }) => {
        if (!active) return
        const raw = (data as any[]) || []
        const rows = raw.map(toMessage).reverse()
        setMessages((prev) => mergeFetched(prev, rows))
        setHasMore(raw.length >= PAGE_SIZE)
        setLoading(false)
      })
    const ch = supabase
      .channel('thread-' + conversation.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_messages', filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const incoming = toMessage(payload.new)
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev
          // Dedup the echo of an optimistic send: adopt it into the temp bubble.
          let idx = incoming.wa_message_id
            ? prev.findIndex((m) => isTempId(m.id) && m.wa_message_id === incoming.wa_message_id)
            : -1
          if (idx < 0 && incoming.direction === 'outbound') {
            idx = prev.findIndex((m) => isTempId(m.id) && m.status === 'sending' && m.body === incoming.body)
          }
          if (idx >= 0) {
            const next = prev.slice()
            next[idx] = incoming
            return next
          }
          return [...prev, incoming]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guest_messages', filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
        const updated = toMessage(payload.new)
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === updated.id)
          if (idx < 0) return prev
          const next = prev.slice()
          next[idx] = updated
          return next
        })
      })
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

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreRef.current) return
    const oldest = messagesRef.current.find((m) => !isTempId(m.id))
    if (!oldest) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const { data } = await supabase
        .from('guest_messages')
        .select(MSG_COLS)
        .eq('conversation_id', conversation.id)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      const raw = (data as any[]) || []
      const older = raw.map(toMessage).reverse()
      if (older.length) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id))
          const add = older.filter((m) => !ids.has(m.id))
          return add.length ? [...add, ...prev] : prev
        })
      }
      if (raw.length < PAGE_SIZE) setHasMore(false)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [conversation.id])

  // Background delivery for one optimistic bubble; reconciles or marks it failed.
  const deliver = useCallback(async (tempId: string, body: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: { conversation_id: conversation.id, to: conversation.wa_phone, text: body },
      })
      const errMsg = (data as any)?.error || error?.message
      if (errMsg) throw new Error(String(errMsg))
      const wamid: string | null = (data as any)?.wamid ?? null
      if ((data as any)?.via === 'template') {
        setInfo("Guest's 24h window was closed — delivered as the approved update template (small template fee).")
      }
      setMessages((prev) => {
        // If the realtime echo already landed (matched by wamid), drop the temp bubble.
        if (wamid && prev.some((m) => m.id !== tempId && m.wa_message_id === wamid)) {
          return prev.filter((m) => m.id !== tempId)
        }
        return prev.map((m) => (m.id === tempId ? { ...m, wa_message_id: wamid, status: 'sent' } : m))
      })
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)))
    }
  }, [conversation.id, conversation.wa_phone])

  // Media delivery: the file is already uploaded to inbox-media (public URL) when this runs.
  const deliverMedia = useCallback(async (tempId: string, mediaUrl: string, kind: string, filename?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: { conversation_id: conversation.id, to: conversation.wa_phone, media_url: mediaUrl, media_type: kind, filename },
      })
      const errMsg = (data as any)?.error || error?.message
      if (errMsg) {
        if ((data as any)?.window_closed) setError(String(errMsg))
        throw new Error(String(errMsg))
      }
      const wamid: string | null = (data as any)?.wamid ?? null
      setMessages((prev) => {
        if (wamid && prev.some((m) => m.id !== tempId && m.wa_message_id === wamid)) {
          return prev.filter((m) => m.id !== tempId)
        }
        return prev.map((m) => (m.id === tempId ? { ...m, wa_message_id: wamid, media_url: mediaUrl, status: 'sent' } : m))
      })
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)))
    }
  }, [conversation.id, conversation.wa_phone])

  // Attach flow: optimistic bubble with a local preview, upload to storage, then send the link.
  const handleSendMedia = useCallback(async (file: File) => {
    setError(null)
    const isImage = /^image\/(jpeg|png|webp)$/.test(file.type)
    const isVideo = file.type === 'video/mp4'
    const kind = isImage ? 'image' : isVideo ? 'video' : 'document'
    const maxBytes = isImage ? 5 * 1024 * 1024 : isVideo ? 16 * 1024 * 1024 : 25 * 1024 * 1024
    if (file.size > maxBytes) {
      setError(`File too large — WhatsApp allows up to ${Math.round(maxBytes / 1024 / 1024)} MB for this type.`)
      return
    }
    const temp: Message = {
      id: newTempId(),
      conversation_id: conversation.id,
      wa_message_id: null,
      direction: 'outbound',
      sender: 'staff',
      msg_type: kind,
      body: kind === 'document' ? file.name : null,
      media_url: URL.createObjectURL(file),
      status: 'sending',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, temp])
    try {
      const ext = (file.name.includes('.') ? file.name.split('.').pop() : '') || (isImage ? 'jpg' : 'bin')
      const path = `outbound/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('inbox-media').upload(path, file, { contentType: file.type || undefined })
      if (upErr) throw new Error(upErr.message)
      const { data: pub } = supabase.storage.from('inbox-media').getPublicUrl(path)
      if (!pub?.publicUrl) throw new Error('upload succeeded but no public URL')
      // Swap the local preview for the durable URL so a later retry can reuse it.
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, media_url: pub.publicUrl } : m)))
      await deliverMedia(temp.id, pub.publicUrl, kind, kind === 'document' ? file.name : undefined)
    } catch (e: any) {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, status: 'failed' } : m)))
      if (!error) setError(e?.message || 'Attachment failed')
    }
  }, [conversation.id, deliverMedia, error])

  const handleSend = useCallback((raw: string) => {
    setError(null)
    const sig = signatureRef.current
    const body = sig ? `${raw}\n\n— ${sig}` : raw
    const temp: Message = {
      id: newTempId(),
      conversation_id: conversation.id,
      wa_message_id: null,
      direction: 'outbound',
      sender: 'staff',
      msg_type: 'text',
      body,
      media_url: null,
      status: 'sending',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, temp])
    void deliver(temp.id, body)
    // Send-to-all-in-room fans out in parallel; only this thread's bubble is optimistic.
    const others = sendAllRef.current ? roomPhonesRef.current : []
    if (others.length) {
      void Promise.all(
        others.map((p) =>
          supabase.functions.invoke('whatsapp-send', { body: { to: p, text: body } })
            .then(({ data, error }) => !(error || (data as any)?.error))
            .catch(() => false),
        ),
      ).then((results) => {
        const failed = results.filter((ok) => !ok).length
        if (failed) setError(`Message sent, but failed for ${failed} other guest${failed > 1 ? 's' : ''} in the room.`)
      })
    }
  }, [conversation.id, deliver])

  const retry = useCallback((id: string) => {
    const m = messagesRef.current.find((x) => x.id === id)
    if (!m) return
    // Media bubble: re-send the already-uploaded link (http URL = upload finished).
    if (m.media_url && m.msg_type !== 'text' && m.media_url.startsWith('http')) {
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'sending' } : x)))
      void deliverMedia(id, m.media_url, m.msg_type === 'image' || m.msg_type === 'video' ? m.msg_type : 'document', m.body || undefined)
      return
    }
    if (!m.body) return
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'sending' } : x)))
    void deliver(id, m.body)
  }, [deliver, deliverMedia])

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
        <WindowChip open={win.open} expiresAt={win.expiresAt} />
      </div>

      <MessageList
        messages={messages}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        onRetry={retry}
      />

      {error && <div className="bg-red-900/60 text-red-200 text-xs px-4 py-2">{error}</div>}
      {info && <div className="bg-wa-header text-wa-muted text-xs px-4 py-2">{info}</div>}
      {!win.open && !error && !info && (
        <div className="bg-amber-900/30 text-amber-200/90 text-[11px] px-4 py-1.5">
          Window closed — text replies deliver as the approved update template; photos and files can be sent again after the guest's next message.
        </div>
      )}

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
        <Composer
          onSend={handleSend}
          onSendFile={handleSendMedia}
          onOpenTemplates={() => setTemplatesOpen(true)}
          windowOpen={win.open}
        />
      </div>

      {linkOpen && (
        <Suspense fallback={null}>
          <LinkRoomModal
            conversationId={conversation.id}
            conversationLabel={title}
            onClose={() => setLinkOpen(false)}
            onLinked={() => setLinkOpen(false)}
          />
        </Suspense>
      )}
      {templatesOpen && (
        <Suspense fallback={null}>
          <TemplateSheet
            conversation={conversation}
            onClose={() => setTemplatesOpen(false)}
            onSent={(msg) => setInfo(msg)}
          />
        </Suspense>
      )}
    </>
  )
}

// Header chip: green while the guest's 24h free-form window is open (with countdown),
// amber once closed. The composer + template picker behavior follows the same state.
function WindowChip({ open, expiresAt }: { open: boolean; expiresAt: number | null }) {
  if (open && expiresAt) {
    const mins = Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
    const lbl = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
    return (
      <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-wa-green/15 text-wa-green border border-wa-green/40 whitespace-nowrap">
        Window OPEN · {lbl}
      </span>
    )
  }
  return (
    <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/40 whitespace-nowrap">
      Window CLOSED
    </span>
  )
}

// Composer owns its own text state so typing never re-renders the message list.
const Composer = memo(function Composer({ onSend, onSendFile, onOpenTemplates, windowOpen }: { onSend: (raw: string) => void; onSendFile: (file: File) => void; onOpenTemplates: () => void; windowOpen: boolean }) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-grow up to ~6 lines, then scroll inside the textarea.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'
  }, [text])

  function submit() {
    const raw = text.trim()
    if (!raw) return
    onSend(raw)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  // Paste a screenshot/photo straight into the chat, like WhatsApp Web.
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.kind === 'file')
    const file = item?.getAsFile()
    if (file) { e.preventDefault(); onSendFile(file) }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onSendFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-end gap-2">
      <input ref={fileRef} type="file" className="hidden" onChange={onPick}
        accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx" />
      <button onClick={onOpenTemplates}
        className={`h-11 px-3 rounded-full grid place-items-center shrink-0 text-xs font-semibold ${windowOpen ? 'text-wa-muted hover:text-wa-text bg-wa-search' : 'bg-wa-green text-black'}`}
        aria-label="Send a template" title="Send a template">
        Templates
      </button>
      <button onClick={() => fileRef.current?.click()}
        disabled={!windowOpen}
        title={windowOpen ? 'Attach' : "Window closed — photos and files can only be sent after the guest's next message"}
        className="w-11 h-11 rounded-full text-wa-muted hover:text-wa-text grid place-items-center shrink-0 disabled:opacity-35 disabled:hover:text-wa-muted" aria-label="Attach">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.2-9.19a4 4 0 015.65 5.66l-9.2 9.19a2 2 0 01-2.82-2.83l8.49-8.48" />
        </svg>
      </button>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={windowOpen ? 'Type a message' : 'Type a reply — delivers as approved template'}
        rows={1}
        className="flex-1 px-4 py-2.5 rounded-2xl bg-wa-search text-wa-text outline-none placeholder:text-wa-muted resize-none max-h-36 overflow-y-auto"
      />
      <button onClick={submit} disabled={!text.trim()}
        className="w-11 h-11 rounded-full bg-wa-green text-black grid place-items-center disabled:opacity-50 shrink-0" aria-label="Send">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
    </div>
  )
})
