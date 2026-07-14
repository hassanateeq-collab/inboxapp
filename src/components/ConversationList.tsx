import { useMemo, useState, type ReactNode } from 'react'
import type { Conversation } from '../types'
import { sourceLabel, digits } from '../lib/labels'

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
  items: Conversation[]
  lastAt: number
}

export default function ConversationList({
  conversations, loading, selectedId, onSelect, userEmail, onLogout,
  propertyOptions, propertyFilter, onFilterChange, hasStray,
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
  hasStray: boolean
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
        g = { key, room_number: c.room_number, property_label: c.property_label, booking_source: c.booking_source, booking_name: c.booking_name, isStray: stray, items: [], lastAt: 0 }
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

      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto bg-wa-panel border-b border-wa-border/60 shrink-0">
        <FilterPill active={propertyFilter === 'all'} onClick={() => onFilterChange('all')}>All</FilterPill>
        {propertyOptions.map((o) => (
          <FilterPill key={o.code} active={propertyFilter === o.code} onClick={() => onFilterChange(o.code)}>{o.label}</FilterPill>
        ))}
        {hasStray && <FilterPill active={propertyFilter === 'stray'} onClick={() => onFilterChange('stray')}>Stray</FilterPill>}
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
                      <span className="font-semibold text-wa-text">Room {g.room_number || '—'}</span>
                      {g.property_label && <span className="text-wa-muted">· {g.property_label}</span>}
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
                        <span className="truncate text-sm text-wa-muted">{c.last_message_preview || (g.isStray ? '+' + c.wa_phone : '')}</span>
                        {c.unread_count > 0 && (
                          <span className="bg-wa-green text-black text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 grid place-items-center shrink-0">{c.unread_count}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
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

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors ${active ? 'bg-wa-green text-black font-medium' : 'bg-wa-header text-wa-muted hover:text-wa-text'}`}
    >
      {children}
    </button>
  )
}
