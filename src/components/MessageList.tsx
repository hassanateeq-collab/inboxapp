import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'
import { Ticks } from './Ticks'

const NEAR_BOTTOM_PX = 120
const LOAD_OLDER_PX = 80

function timeShort(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayKey(ts: string): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(ts: string): string {
  const d = new Date(ts)
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function docFileName(url: string, body: string | null): string {
  try {
    const seg = decodeURIComponent(url.split('?')[0].split('#')[0].split('/').pop() || '')
    if (seg && seg.includes('.')) return seg
  } catch { /* fall through */ }
  return (body || '').trim() || 'Document'
}

function MediaBlock({ m }: { m: Message }) {
  if (!m.media_url) return null
  if (m.msg_type === 'image' || m.msg_type === 'sticker') {
    return (
      <a href={m.media_url} target="_blank" rel="noreferrer" className="block mb-1">
        {/* Fixed container so the bubble doesn't shift while the image loads. */}
        <div className="w-[240px] max-w-full h-[240px] rounded-md overflow-hidden bg-black/20">
          <img
            src={m.media_url}
            alt=""
            width={240}
            height={240}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
      </a>
    )
  }
  if (m.msg_type === 'audio' || m.msg_type === 'voice' || m.msg_type === 'ptt') {
    return <audio controls preload="none" src={m.media_url} className="w-60 max-w-full my-1" />
  }
  if (m.msg_type === 'document') {
    return (
      <a
        href={m.media_url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 mb-1 px-2.5 py-2 rounded-md bg-black/20 hover:bg-black/30 transition-colors max-w-[240px]"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-wa-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="text-xs truncate underline underline-offset-2">{docFileName(m.media_url, m.body)}</span>
      </a>
    )
  }
  return null
}

function Bubble({ m, tail, onRetry }: { m: Message; tail: boolean; onRetry: (id: string) => void }) {
  const out = m.direction === 'outbound'
  const hasMedia = !!m.media_url && ['image', 'sticker', 'audio', 'voice', 'ptt', 'document'].includes(m.msg_type)
  const showBodyText = !!m.body && !(m.msg_type === 'document' && hasMedia)
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} px-2`}>
      <div className={`relative max-w-[82%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${out ? 'bg-wa-bubbleOut' : 'bg-wa-bubbleIn'} ${tail ? (out ? 'msg-tail-out' : 'msg-tail-in') : ''}`}>
        {hasMedia && <MediaBlock m={m} />}
        {showBodyText && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
        {!hasMedia && !showBodyText && (
          <span className="text-wa-muted px-1.5 py-0.5 rounded bg-black/20 text-xs">[{m.msg_type}]</span>
        )}
        <span className="text-[10px] text-wa-muted ml-2 float-right mt-1.5 select-none inline-flex items-center gap-1">
          {timeShort(m.created_at)}
          {out && <Ticks status={m.status} />}
        </span>
        {m.status === 'failed' && (
          <div className="clear-both pt-1 text-[11px] text-red-300 flex items-center gap-2">
            <span>Not sent</span>
            <button onClick={() => onRetry(m.id)} className="underline underline-offset-2 hover:text-red-200">Retry</button>
          </div>
        )}
      </div>
    </div>
  )
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1.5">
      <span className="px-3 py-1 rounded-lg bg-wa-header text-wa-muted text-[11px] shadow-sm select-none">{label}</span>
    </div>
  )
}

function SkeletonBubbles() {
  const widths = ['40%', '55%', '35%', '62%', '45%', '30%', '58%', '42%']
  return (
    <div className="space-y-2 animate-pulse" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={`flex ${i % 3 === 2 ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`h-9 rounded-lg ${i % 3 === 2 ? 'bg-wa-bubbleOut/50' : 'bg-wa-bubbleIn/60'}`}
            style={{ width: w }}
          />
        </div>
      ))}
    </div>
  )
}

type Row =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: Message; tail: boolean }

type Props = {
  messages: Message[]
  loading: boolean
  loadingOlder: boolean
  hasMore: boolean
  onLoadOlder: () => void
  onRetry: (id: string) => void
}

function MessageListInner({ messages, loading, loadingOlder, hasMore, onLoadOlder, onRetry }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showChip, setShowChip] = useState(false)
  const atBottomRef = useRef(true)
  // Continuously updated scroll snapshot, used to anchor the viewport when older history is prepended.
  const snapRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const prevRef = useRef<{ first: string | null; last: string | null; len: number }>({ first: null, last: null, len: 0 })

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let lastDay = ''
    let lastDir: string | null = null
    for (const m of messages) {
      const k = dayKey(m.created_at)
      if (k !== lastDay) {
        out.push({ kind: 'divider', key: 'day-' + k, label: dayLabel(m.created_at) })
        lastDay = k
        lastDir = null
      }
      // WhatsApp parity: the first bubble of each same-direction run carries the tail.
      out.push({ kind: 'msg', key: m.id, msg: m, tail: m.direction !== lastDir })
      lastDir = m.direction
    }
    return out
  }, [messages])

  function takeSnapshot() {
    const el = containerRef.current
    if (el) snapRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
  }

  function scrollToBottom(smooth: boolean) {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottomRef.current = true
    setShowChip(false)
  }

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottomRef.current = dist < NEAR_BOTTOM_PX
    if (atBottomRef.current) setShowChip(false)
    takeSnapshot()
    if (el.scrollTop < LOAD_OLDER_PX && hasMore && !loading && messages.length > 0) onLoadOlder()
  }

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const first = messages.length ? messages[0].id : null
    const last = messages.length ? messages[messages.length - 1] : null
    const prev = prevRef.current
    prevRef.current = { first, last: last ? last.id : null, len: messages.length }

    // First paint with content (from cache or first fetch): pin to bottom instantly, no animation.
    if (prev.len === 0) {
      if (messages.length) {
        el.scrollTop = el.scrollHeight
        atBottomRef.current = true
      }
      takeSnapshot()
      return
    }
    // Older history prepended: keep the viewport anchored (no visual jump).
    if (first && prev.first && first !== prev.first && messages.some((m) => m.id === prev.first)) {
      const snap = snapRef.current
      if (snap) el.scrollTop = snap.scrollTop + (el.scrollHeight - snap.scrollHeight)
      takeSnapshot()
      return
    }
    // Appended (or reconciled) at the end. Status-only UPDATEs don't change the last id: no scroll.
    if (last && last.id !== prev.last) {
      const singleAppend = messages.length === prev.len + 1
      const ownSend = last.direction === 'outbound' && last.id.startsWith('temp-')
      if (ownSend || atBottomRef.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: singleAppend ? 'smooth' : 'auto' })
        atBottomRef.current = true
        setShowChip(false)
      } else if (last.direction === 'inbound') {
        setShowChip(true)
      }
      takeSnapshot()
    }
  }, [messages])

  return (
    <div className="relative flex-1 min-h-0 wa-chat-bg">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ overflowAnchor: 'none' }}
        className="absolute inset-0 overflow-y-auto px-4 md:px-16 py-4 space-y-1.5"
      >
        {loading && messages.length === 0 ? (
          <SkeletonBubbles />
        ) : (
          <>
            {(hasMore || loadingOlder) && messages.length > 0 && (
              <div className="flex justify-center py-1.5" aria-hidden>
                <div className={`w-5 h-5 rounded-full border-2 border-wa-border border-t-wa-green ${loadingOlder ? 'animate-spin' : 'opacity-40'}`} />
              </div>
            )}
            {rows.map((r) =>
              r.kind === 'divider' ? <DayDivider key={r.key} label={r.label} /> : <Bubble key={r.key} m={r.msg} tail={r.tail} onRetry={onRetry} />,
            )}
            {!loading && messages.length === 0 && (
              <p className="text-wa-muted text-sm text-center pt-8">No messages yet.</p>
            )}
          </>
        )}
      </div>
      {showChip && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 right-4 z-10 px-3 py-1.5 rounded-full bg-wa-header text-wa-text text-xs shadow-lg border border-wa-border flex items-center gap-1.5 hover:bg-wa-hover transition-colors"
        >
          <span aria-hidden>&#8595;</span> New message
        </button>
      )}
    </div>
  )
}

const MessageList = memo(MessageListInner)
export default MessageList
