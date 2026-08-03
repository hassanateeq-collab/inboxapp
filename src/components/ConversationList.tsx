import { useMemo, useState, type ReactNode } from 'react'
import { stayStateOf, type Conversation, type RosterEntry, type StayState } from '../types'
import { sourceLabel, digits } from '../lib/labels'
import { Ticks } from './Ticks'

// Why an in-house room has no WhatsApp thread — reception fixes these at the desk.
function gapReason(r: RosterEntry): { label: string; cls: string } {
  if (r.status === 'no_number' || r.with_number_count === 0)
    return { label: 'No number attached', cls: 'bg-red-500/15 text-red-400' }
  if (r.attached_invalid > 0)
    return { label: 'Number not on WhatsApp', cls: 'bg-red-500/15 text-red-400' }
  if (r.attached_count === 0)
    return { label: 'Number not linked', cls: 'bg-amber-500/15 text-amber-400' }
  return { label: 'No messages yet', cls: 'bg-wa-header text-wa-muted' }
}

function timeShort(ts: string | null) {
  if (!ts) return ''
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

type Group = {
  key: string
  room_number: string | null
  property_label: string | null
  booking_source: string | null
  booking_name: string | null
  isStray: boolean
  state: StayState
  beds24: number | null
  checkIn: string | null
  checkOut: string | null
  items: Conversation[]
  lastAt: number
}

function fmtShortDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''
}

// Compact stay range for nameplates: "03–04 Aug" or "30 Jul–05 Aug".
function fmtStayRange(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn && !checkOut) return ''
  if (!checkIn) return `→ ${fmtShortDate(checkOut)}`
  if (!checkOut) return `${fmtShortDate(checkIn)} →`
  const a = new Date(checkIn); const b = new Date(checkOut)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${String(a.getDate()).padStart(2, '0')}–${fmtShortDate(checkOut)}`
  }
  return `${fmtShortDate(checkIn)}–${fmtShortDate(checkOut)}`
}

export default function ConversationList({
  conversations, loading, selectedId, onSelect, userEmail, onLogout,
  propertyOptions, propertyFilter, onFilterChange,
  stayFilter, onStayFilterChange, unreadByState, rosterGaps,
}: {
  conversations: Conversation[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  userEmail: string
  onLogout: () => void
  propertyOptions: { code: string; label: string }[]
  propertyFilter: string
  onFilterChange: (v: string) => void
  stayFilter: StayState | 'all'
  onStayFilterChange: (v: StayState | 'all') => void
  unreadByState: Record<StayState, number>
  rosterGaps: RosterEntry[]
}) {
  const [query, setQuery] = useState('')

  const searched = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return conversations
    const sDigits = digits(s)
    return conversations.filter((c) =>
      (c.display_name || '').toLowerCase().includes(s) ||
      (c.booking_name || '').toLowerCase().includes(s) ||
      (c.room_number || '').toLowerCase().includes(s) ||
      (sDigits !== '' && digits(c.wa_phone).includes(sDigits)),
    )
  }, [conversations, query])

  const groups = useMemo(() => {
    const m = new Map<string, Group>()
    for (const c of searched) {
      const stray = !c.booking_id && !c.room_number
      const key = stray ? '__stray__' : (c.booking_id || 'room:' + c.room_number)
      let g = m.get(key)
      if (!g) {
        g = { key, room_number: c.room_number, property_label: c.property_label, booking_source: c.booking_source, booking_name: c.booking_name, isStray: stray, state: stayStateOf(c), beds24: c.beds24_booking_id, checkIn: c.check_in, checkOut: c.check_out, items: [], lastAt: 0 }
        m.set(key, g)
      }
      g.items.push(c)
      const t = c.last_message_at ? Date.parse(c.last_message_at) : 0
      if (t > g.lastAt) g.lastAt = t
    }
    const arr = Array.from(m.values())
    arr.sort((a, b) => (a.isStray !== b.isStray ? (a.isStray ? 1 : -1) : b.lastAt - a.lastAt))
    for (const g of arr) g.items.sort((x, y) => (Date.parse(y.last_message_at || '') || 0) - (Date.parse(x.last_message_at || '') || 0))
    return arr
  }, [searched])

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between bg-wa-header shrink-0">
        <span className="font-semibold text-lg">Inbox</span>
        <div className="flex items-center gap-3 text-wa-muted text-xs">
          <span className="hidden sm:inline max-w-[140px] truncate">{userEmail}</span>
          <button onClick={onLogout} className="hover:text-wa-text underline-offset-2 hover:underline">Log out</button>
        </div>
      </div>

      <div className="px-3 pt-2 pb-1 bg-wa-panel shrink-0">
        <div className="relative">
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-wa-muted pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, room, or phone"
            className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-wa-search text-wa-text text-sm outline-none placeholder:text-wa-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-wa-muted hover:text-wa-text p-0.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto bg-wa-panel shrink-0">
        <FilterPill active={propertyFilter === 'all'} onClick={() => onFilterChange('all')}>All</FilterPill>
        {propertyOptions.map((o) => (
          <FilterPill key={o.code} active={propertyFilter === o.code} onClick={() => onFilterChange(o.code)}>{o.label}</FilterPill>
        ))}
      </div>

      {/* Stay-state tabs with live unread badges — a message in any tab is visible from anywhere. */}
      <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto bg-wa-panel border-b border-wa-border/60 shrink-0">
        <FilterPill active={stayFilter === 'inhouse'} onClick={() => onStayFilterChange('inhouse')} unread={unreadByState.inhouse}>In-house</FilterPill>
        <FilterPill active={stayFilter === 'arriving'} onClick={() => onStayFilterChange('arriving')} unread={unreadByState.arriving}>Arriving</FilterPill>
        <FilterPill active={stayFilter === 'past'} onClick={() => onStayFilterChange('past')} unread={unreadByState.past}>Checked out</FilterPill>
        <FilterPill active={stayFilter === 'unknown'} onClick={() => onStayFilterChange('unknown')} unread={unreadByState.unknown}>Unknown</FilterPill>
        <FilterPill active={stayFilter === 'all'} onClick={() => onStayFilterChange('all')}>All</FilterPill>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <SkeletonRows />
        ) : (
          <>
            {groups.length === 0 && (
              <p className="text-wa-muted text-sm p-4">{query ? 'No conversations match your search.' : 'No conversations here yet.'}</p>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                <div className="px-3 py-1.5 bg-wa-panel border-b border-wa-border/40 sticky top-0 z-10">
                  {g.isStray ? (
                    <div className="text-[11px] uppercase tracking-wide text-wa-muted">Not linked to a room</div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] min-w-0">
                      {/* Past stays are identified by BOOKING number, not room — the room belongs to
                          someone else now, and repeat guests stay in different rooms. */}
                      {g.state === 'past' ? (
                        <span className="font-semibold text-wa-muted">#{g.beds24 || '—'}</span>
                      ) : g.state === 'arriving' ? (
                        <span className="font-semibold text-wa-text">{g.room_number ? `Room ${g.room_number}` : `#${g.beds24 || '—'}`}</span>
                      ) : (
                        <span className="font-semibold text-wa-text">Room {g.room_number || '—'}</span>
                      )}
                      {g.property_label && <span className="text-wa-muted">· {g.property_label}</span>}
                      {(g.checkIn || g.checkOut) && (
                        <span className="text-wa-muted tabular-nums">· {fmtStayRange(g.checkIn, g.checkOut)}</span>
                      )}
                      {g.state === 'past' && (
                        <span className="px-1.5 py-0.5 rounded bg-wa-header text-amber-400/90">departed</span>
                      )}
                      {g.state === 'arriving' && (
                        <span className="px-1.5 py-0.5 rounded bg-wa-header text-sky-400/90">arriving</span>
                      )}
                      {g.booking_source && <span className="px-1.5 py-0.5 rounded bg-wa-header text-wa-muted">{sourceLabel(g.booking_source)}</span>}
                      {g.booking_name && <span className="text-wa-muted truncate">· {g.booking_name}</span>}
                    </div>
                  )}
                </div>
                {g.items.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-wa-hover transition-colors border-b border-wa-border/30 ${selectedId === c.id ? 'bg-wa-hover' : ''}`}
                  >
                    <div className="w-11 h-11 rounded-full bg-wa-header grid place-items-center text-wa-muted font-medium shrink-0">
                      {(c.display_name || c.wa_phone).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="truncate font-medium">{c.display_name || '+' + c.wa_phone}</span>
                        <span className="text-[11px] text-wa-muted shrink-0">{timeShort(c.last_message_at)}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2 mt-0.5">
                        <span className="truncate text-sm text-wa-muted inline-flex items-center gap-1 min-w-0">
                          {c.last_message_direction === 'outbound' && (
                            <span className="shrink-0 inline-flex"><Ticks status={c.last_message_status} /></span>
                          )}
                          <span className="truncate">{c.last_message_preview || (g.isStray ? '+' + c.wa_phone : '')}</span>
                        </span>
                        {c.unread_count > 0 && (
                          <span className="bg-wa-green text-black text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 grid place-items-center shrink-0">{c.unread_count}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {rosterGaps.length > 0 && !query && (
              <div>
                <div className="px-3 py-1.5 bg-wa-panel border-y border-wa-border/40 sticky top-0 z-10">
                  <div className="text-[11px] uppercase tracking-wide text-red-400/90 font-semibold">
                    Not connected to WhatsApp ({rosterGaps.length})
                  </div>
                </div>
                {rosterGaps.map((r) => {
                  const reason = gapReason(r)
                  return (
                    <div key={r.booking_id} className="flex items-center gap-3 px-3 py-2.5 border-b border-wa-border/30 opacity-90">
                      <div className="w-11 h-11 rounded-full border border-dashed border-wa-border grid place-items-center text-wa-muted text-xs font-medium shrink-0">
                        {(r.room_number || '?').slice(0, 4)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="font-medium">Room {r.room_number || '—'}</span>
                          <span className="text-[11px] text-wa-muted">· {r.property_code || '—'}</span>
                          {r.booking_source && (
                            <span className="px-1.5 py-0.5 rounded bg-wa-header text-wa-muted text-[10px]">{sourceLabel(r.booking_source)}</span>
                          )}
                          <span className="text-sm text-wa-muted truncate">{r.primary_name || 'Guest'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 min-w-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${reason.cls}`}>{reason.label}</span>
                          {r.primary_number && <span className="text-xs text-wa-muted truncate">{r.primary_number}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function SkeletonRows() {
  return (
    <div className="animate-pulse" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-wa-border/30">
          <div className="w-11 h-11 rounded-full bg-wa-header shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 rounded bg-wa-header" style={{ width: `${45 + (i % 4) * 10}%` }} />
            <div className="h-2.5 rounded bg-wa-header/70" style={{ width: `${60 + (i % 3) * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function FilterPill({ active, onClick, unread, children }: { active: boolean; onClick: () => void; unread?: number; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors inline-flex items-center gap-1.5 ${active ? 'bg-wa-green text-black font-medium' : 'bg-wa-header text-wa-muted hover:text-wa-text'}`}
    >
      {children}
      {(unread ?? 0) > 0 && (
        <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center ${active ? 'bg-black/20 text-black' : 'bg-wa-green text-black'}`}>
          {unread}
        </span>
      )}
    </button>
  )
}
