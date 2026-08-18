import { useMemo, useState, type ReactNode } from 'react'
import { stayStateOf, windowInfo, type Conversation, type RosterEntry, type SortBy, type StayState } from '../types'
import { sourceLabel, digits, avatarColor } from '../lib/labels'
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

// "today" / "tomorrow" / "19 Aug" — how far away an arriving guest's check-in is.
function arriveLabel(checkIn: string | null): string {
  if (!checkIn) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(checkIn + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' })
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
  unreplied: boolean
  bookedAt: string | null
  room_number: string | null
  room_type: string | null
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
  sortBy, onSortChange,
  arrivalDay, onArrivalDayChange, numberIssues, onNumberIssuesChange,
  onStartChat, gapBusyId, gapError,
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
  sortBy: SortBy
  onSortChange: (v: SortBy) => void
  arrivalDay: string
  onArrivalDayChange: (v: string) => void
  numberIssues: boolean
  onNumberIssuesChange: (v: boolean) => void
  rosterGaps: RosterEntry[]
  onStartChat: (r: RosterEntry) => void
  gapBusyId: string | null
  gapError: string | null
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
        g = { key, unreplied: false, bookedAt: c.booked_at, room_number: c.room_number, room_type: c.room_type, property_label: c.property_label, booking_source: c.booking_source, booking_name: c.booking_name, isStray: stray, state: stayStateOf(c), beds24: c.beds24_booking_id, checkIn: c.check_in, checkOut: c.check_out, items: [], lastAt: 0 }
        m.set(key, g)
      }
      g.items.push(c)
      if (c.last_message_direction === 'inbound') g.unreplied = true
      const t = c.last_message_at ? Date.parse(c.last_message_at) : 0
      if (t > g.lastAt) g.lastAt = t
    }
    const arr = Array.from(m.values())
    arr.sort((a, b) => {
      if (a.isStray !== b.isStray) return a.isStray ? 1 : -1
      // default: guests still waiting for a reply always come first
      if (sortBy === 'unreplied' && a.unreplied !== b.unreplied) return a.unreplied ? -1 : 1
      if (sortBy === 'booked') {
        const ab = a.bookedAt || ''; const bb = b.bookedAt || ''
        if (ab !== bb) return ab > bb ? -1 : 1 // newest booking first; no booking sinks
      }
      if (sortBy === 'arrival') {
        const ai = a.checkIn || '9999-99-99'; const bi = b.checkIn || '9999-99-99'
        if (ai !== bi) return ai < bi ? -1 : 1
      }
      return b.lastAt - a.lastAt
    })
    for (const g of arr) g.items.sort((x, y) => (Date.parse(y.last_message_at || '') || 0) - (Date.parse(x.last_message_at || '') || 0))
    return arr
  }, [searched, sortBy])

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
      <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto bg-wa-panel shrink-0">
        <FilterPill active={stayFilter === 'inhouse'} onClick={() => onStayFilterChange('inhouse')} unread={unreadByState.inhouse}>In-house</FilterPill>
        <FilterPill active={stayFilter === 'arriving'} onClick={() => onStayFilterChange('arriving')} unread={unreadByState.arriving}>Arriving</FilterPill>
        <FilterPill active={stayFilter === 'past'} onClick={() => onStayFilterChange('past')} unread={unreadByState.past}>Checked out</FilterPill>
        <FilterPill active={stayFilter === 'unknown'} onClick={() => onStayFilterChange('unknown')} unread={unreadByState.unknown}>Unknown</FilterPill>
        <FilterPill active={stayFilter === 'all'} onClick={() => onStayFilterChange('all')}>All</FilterPill>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          style={{ colorScheme: 'dark' }}
          className="ml-auto bg-transparent text-wa-muted text-xs border border-wa-border/80 rounded-full px-2 py-0.5 outline-none shrink-0"
          title="Sort conversations"
        >
          <option value="booked">Newest bookings</option>
          <option value="unreplied">Not replied first</option>
          <option value="recent">Latest first</option>
          <option value="arrival">Arrival date</option>
        </select>
      </div>

      {stayFilter === 'arriving' && (
        <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto bg-wa-panel shrink-0 items-center">
          <FilterPill active={arrivalDay === 'all'} onClick={() => onArrivalDayChange('all')}>All dates</FilterPill>
          <FilterPill active={arrivalDay === 'today'} onClick={() => onArrivalDayChange('today')}>Today</FilterPill>
          <FilterPill active={arrivalDay === 'tomorrow'} onClick={() => onArrivalDayChange('tomorrow')}>Tomorrow</FilterPill>
          <input
            type="date"
            value={/^\d{4}-\d{2}-\d{2}$/.test(arrivalDay) ? arrivalDay : ''}
            onChange={(e) => onArrivalDayChange(e.target.value || 'all')}
            style={{ colorScheme: 'dark' }}
            className={`px-2.5 py-0.5 rounded-full text-xs shrink-0 outline-none border bg-transparent ${/^\d{4}-\d{2}-\d{2}$/.test(arrivalDay) ? 'text-wa-green border-wa-green/60 bg-wa-green/10' : 'text-wa-muted border-wa-border/80'}`}
            title="Show guests arriving on an exact date"
          />
          <button
            onClick={() => onNumberIssuesChange(!numberIssues)}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors border ${numberIssues ? 'bg-red-500/15 text-red-300 border-transparent font-medium' : 'bg-transparent text-wa-muted border-wa-border/80 hover:bg-wa-header'}`}
            title="Only guests whose WhatsApp number is missing, invalid, or failing to deliver"
          >
            Number issues
          </button>
        </div>
      )}

      {stayFilter !== 'arriving' && unreadByState.arriving > 0 && (
        <button
          onClick={() => onStayFilterChange('arriving')}
          className="w-full text-left px-3 py-2.5 bg-sky-500/15 border-y border-sky-500/30 hover:bg-sky-500/25 transition-colors flex items-center justify-between gap-2"
        >
          <span className="text-sky-200 text-xs font-medium">
            {unreadByState.arriving} unread message{unreadByState.arriving > 1 ? 's' : ''} from arriving guests
          </span>
          <span className="text-sky-300 text-xs font-bold shrink-0">View →</span>
        </button>
      )}

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
                <div className="px-3 py-1 bg-wa-panel/95 backdrop-blur-sm sticky top-0 z-10">
                  {g.isStray ? (
                    <div className="text-[10px] uppercase tracking-wider text-wa-muted/80">Not linked to a room</div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] min-w-0 text-wa-muted">
                      {/* Past stays are identified by BOOKING number, not room — the room belongs to
                          someone else now, and repeat guests stay in different rooms. */}
                      {g.state === 'past' ? (
                        <span className="font-semibold">#{g.beds24 || '—'}</span>
                      ) : g.state === 'arriving' ? (
                        <span className="font-semibold text-wa-text/90">#{g.beds24 || '—'}{g.room_type ? ` · ${g.room_type}` : ''}</span>
                      ) : (
                        <span className="font-semibold text-wa-text/90">{g.room_number ? `Room ${g.room_number}` : `#${g.beds24 || '—'}`}</span>
                      )}
                      {g.property_label && <span>· {g.property_label}</span>}
                      {(g.checkIn || g.checkOut) && <span className="tabular-nums">· {fmtStayRange(g.checkIn, g.checkOut)}</span>}
                      {g.state === 'past' && <span className="text-amber-400/90">· departed</span>}
                      {g.state === 'arriving' && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold uppercase tracking-wide text-[9.5px]">
                          Arriving {arriveLabel(g.checkIn)}
                        </span>
                      )}
                      {g.booking_source && <span>· {sourceLabel(g.booking_source)}</span>}
                      {g.booking_name && <span className="truncate">· {g.booking_name}</span>}
                      {g.unreplied && (
                        <span className="px-1.5 py-0.5 rounded bg-wa-green/15 text-wa-green border border-wa-green/40 font-bold uppercase tracking-wide text-[9.5px]">
                          Awaiting reply
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {g.items.map((c) => {
                  const name = c.display_name || '+' + c.wa_phone
                  const win = windowInfo(c).open
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelect(c.id)}
                      className={`w-full flex items-center gap-3 pl-3 pr-0 text-left hover:bg-wa-hover transition-colors ${selectedId === c.id ? 'bg-wa-hover' : ''}`}
                    >
                      <div className="relative shrink-0">
                        <div
                          className="w-12 h-12 rounded-full grid place-items-center text-white/90 text-lg font-medium"
                          style={{ backgroundColor: avatarColor(name) }}
                        >
                          {name.replace('+', '').slice(0, 1).toUpperCase()}
                        </div>
                        {/* 24h window state as a presence dot: green = open (free replies), amber = closed */}
                        <span
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-wa-panel ${win ? 'bg-wa-green' : 'bg-amber-500'}`}
                          title={win ? 'Window open — replies are free' : 'Window closed — replies deliver as approved templates'}
                        />
                      </div>
                      <div className="min-w-0 flex-1 py-2.5 pr-3 border-b border-wa-border/40">
                        <div className="flex justify-between items-baseline gap-2">
                          <span className="min-w-0 flex items-center gap-1.5">
                            <span className="truncate text-[15px] text-wa-text">{name}</span>
                            {stayStateOf(c) === 'arriving' && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-semibold whitespace-nowrap">
                                Arriving {arriveLabel(c.check_in)}
                              </span>
                            )}
                          </span>
                          <span className={`text-[11px] shrink-0 ${c.unread_count > 0 ? 'text-wa-green font-medium' : 'text-wa-muted'}`}>
                            {timeShort(c.last_message_at)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2 mt-0.5">
                          <span className="truncate text-[13px] text-wa-muted inline-flex items-center gap-1 min-w-0">
                            {c.last_message_direction === 'outbound' && (
                              <span className="shrink-0 inline-flex"><Ticks status={c.last_message_status} /></span>
                            )}
                            <span className="truncate">{c.last_message_preview || (g.isStray ? '+' + c.wa_phone : '')}</span>
                          </span>
                          {c.unread_count > 0 ? (
                            <span className="bg-wa-green text-black text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 grid place-items-center shrink-0">{c.unread_count}</span>
                          ) : c.last_read_by && c.last_message_direction === 'inbound' ? (
                            // Shared read state: show who picked this message up.
                            <span className="text-[10px] text-wa-muted shrink-0 whitespace-nowrap">seen · {c.last_read_by}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
            {rosterGaps.length > 0 && !query && (
              <div>
                <div className="px-3 py-1.5 bg-wa-panel border-y border-wa-border/40 sticky top-0 z-10">
                  {stayFilter === 'arriving' ? (
                    <div className="text-[11px] uppercase tracking-wide text-sky-400/90 font-semibold">
                      Arriving — not yet checked in ({rosterGaps.length})
                    </div>
                  ) : (
                    <div className="text-[11px] uppercase tracking-wide text-red-400/90 font-semibold">
                      Not connected to WhatsApp ({rosterGaps.length})
                    </div>
                  )}
                </div>
                {gapError && (
                  <div className="mx-3 my-2 px-3 py-2 rounded-lg bg-red-900/40 border border-red-800/60 text-red-200 text-xs">
                    {gapError}
                  </div>
                )}
                {rosterGaps.map((r) => {
                  const reason = gapReason(r)
                  const busy = gapBusyId === r.booking_id
                  return (
                    <button
                      key={r.booking_id}
                      onClick={() => onStartChat(r)}
                      disabled={gapBusyId !== null}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-wa-border/30 opacity-90 hover:opacity-100 hover:bg-wa-hover transition-colors disabled:cursor-wait"
                      title="Open a chat and send an approved template to this guest"
                    >
                      <div className="w-11 h-11 rounded-full border border-dashed border-wa-border grid place-items-center text-wa-muted text-xs font-medium shrink-0">
                        {r.stay_state === 'arriving' ? (fmtShortDate(r.check_in) || '?') : (r.room_number || '?').slice(0, 4)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          {r.stay_state === 'arriving' ? (
                            <span className="font-medium">#{r.beds24_booking_id || '—'}{r.room_type ? ` · ${r.room_type}` : ''}</span>
                          ) : (
                            <span className="font-medium">Room {r.room_number || '—'}</span>
                          )}
                          <span className="text-[11px] text-wa-muted">· {r.property_code || '—'}</span>
                          {(r.check_in || r.check_out) && (
                            <span className="text-[11px] text-wa-muted tabular-nums">· {fmtStayRange(r.check_in, r.check_out)}</span>
                          )}
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
                      <span className={`shrink-0 text-[11px] font-semibold ${busy ? 'text-wa-muted' : 'text-wa-green'}`}>
                        {busy ? 'Opening…' : 'Message →'}
                      </span>
                    </button>
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

// WhatsApp-web-style filter pill: outlined when idle, dim-green fill when active.
function FilterPill({ active, onClick, unread, children }: { active: boolean; onClick: () => void; unread?: number; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors inline-flex items-center gap-1.5 border ${active ? 'bg-wa-green/15 text-wa-green border-transparent font-medium' : 'bg-transparent text-wa-muted border-wa-border/80 hover:bg-wa-header'}`}
    >
      {children}
      {(unread ?? 0) > 0 && (
        <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center ${active ? 'bg-wa-green text-black' : 'bg-wa-green text-black'}`}>
          {unread}
        </span>
      )}
    </button>
  )
}
