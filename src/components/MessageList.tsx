import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'
import { Ticks } from './Ticks'

const REACT_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

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

// Outbound interactive/template sends log their buttons as a trailing "[Label] [Label]".
// Render them as WhatsApp-style button rows instead of raw brackets.
function splitButtons(body: string): { text: string; buttons: string[] } {
  const m = body.match(/\s+((?:\[[^\[\]\n]{1,40}\]\s*){1,3})$/)
  if (!m || m.index === undefined || m.index === 0) return { text: body, buttons: [] }
  const labels = [...m[1].matchAll(/\[([^\[\]\n]{1,40})\]/g)].map((x) => x[1])
  if (labels.length === 0) return { text: body, buttons: [] }
  return { text: body.slice(0, m.index).trimEnd(), buttons: labels }
}

const URL_RE = /(https?:\/\/[^\s]+)/g

// Plain-text bodies with tappable links, exactly like WhatsApp shows them.
function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2 break-all">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
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

function Bubble({ m, tail, onRetry, onReact, canReact }: {
  m: Message
  tail: boolean
  onRetry: (id: string) => void
  onReact: (m: Message, emoji: string) => void
  canReact: boolean
}) {
  const out = m.direction === 'outbound'
  const hasMedia = !!m.media_url && ['image', 'sticker', 'audio', 'voice', 'ptt', 'document'].includes(m.msg_type)
  const showBodyText = !!m.body && !(m.msg_type === 'document' && hasMedia)
  // Only outbound bodies carry the trailing button convention; guest text is shown verbatim.
  const parsed = out && m.body ? splitButtons(m.body) : { text: m.body || '', buttons: [] }
  const reactions = m.reactions && Object.keys(m.reactions).length > 0 ? m.reactions : null
  const [pick, setPick] = useState(false)
  const showReactBtn = !out && canReact && !!m.wa_message_id
  return (
    <div className={`group flex items-center ${out ? 'justify-end' : 'justify-start'} px-2 ${reactions ? 'mb-3' : ''}`}>
      <div className={`relative max-w-[82%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${out ? 'bg-wa-bubbleOut' : 'bg-wa-bubbleIn'} ${tail ? (out ? 'msg-tail-out' : 'msg-tail-in') : ''}`}>
        {hasMedia && <MediaBlock m={m} />}
        {showBodyText && <span className="whitespace-pre-wrap break-words"><Linkify text={parsed.text} /></span>}
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
        {parsed.buttons.length > 0 && (
          <div className="clear-both mt-2 -mx-2.5 -mb-1.5 border-t border-black/25" title="Buttons the guest can tap in WhatsApp">
            {parsed.buttons.map((b) => (
              <div key={b} className="text-center text-sky-300 text-[13px] font-medium py-1.5 border-b border-black/25 last:border-b-0 select-none">
                {b}
              </div>
            ))}
          </div>
        )}
        {/* WhatsApp-style reaction chip(s) overlapping the bubble's bottom edge */}
        {reactions && (
          <div className={`absolute -bottom-3.5 ${out ? 'right-1' : 'left-1'} flex gap-0.5 z-[1]`}>
            {Object.entries(reactions).map(([who, e]) => (
              <button
                key={who}
                onClick={() => { if (who === 'staff' && canReact) onReact(m, e) }}
                title={who === 'staff' ? 'Your reaction — tap to remove' : "Guest's reaction"}
                className={`bg-wa-header border border-wa-border rounded-full px-1.5 py-0.5 text-[13px] leading-none shadow ${who === 'staff' && canReact ? 'cursor-pointer' : 'cursor-default'}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Hover react button (guest messages, window open) — like WhatsApp's hover smiley */}
      {showReactBtn && (
        <div className="relative shrink-0">
          <button
            onClick={() => setPick((v) => !v)}
            className="w-7 h-7 ml-1.5 rounded-full bg-wa-header text-wa-muted hover:text-wa-text grid place-items-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label="React"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 10h.01M15 10h.01" />
            </svg>
          </button>
          {pick && (
            <div className="absolute bottom-9 left-0 z-20 flex gap-1.5 bg-wa-header border border-wa-border rounded-full px-2.5 py-1.5 shadow-xl">
              {REACT_EMOJIS.map((e) => (
                <button key={e} className="text-[17px] leading-none hover:scale-125 transition-transform"
                  onClick={() => { setPick(false); onReact(m, e) }}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  onReact: (m: Message, emoji: string) => void
  canReact: boolean
}

function MessageListInner({ messages, loading, loadingOlder, hasMore, onLoadOlder, onRetry, onReact, canReact }: Props) {
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
      // Legacy standalone reaction rows (pre-v16 webhook) render on the target message now.
      if (m.msg_type === 'reaction') continue
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
              r.kind === 'divider' ? <DayDivider key={r.key} label={r.label} /> : <Bubble key={r.key} m={r.msg} tail={r.tail} onRetry={onRetry} onReact={onReact} canReact={canReact} />,
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
