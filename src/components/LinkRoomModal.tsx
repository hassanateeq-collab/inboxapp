import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sourceLabel } from '../lib/labels'

type Booking = {
  id: string
  beds24_booking_id: number | null
  property_label: string | null
  property_code: string | null
  booking_source: string | null
  room_number: string | null
  guest_name: string | null
  check_in: string | null
  check_out: string | null
  checkin_status: string | null
}

export default function LinkRoomModal({ conversationId, conversationLabel, onClose, onLinked }: {
  conversationId: string
  conversationLabel: string
  onClose: () => void
  onLinked: () => void
}) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    supabase.from('v_inbox_linkable_bookings')
      .select('id, beds24_booking_id, property_label, property_code, booking_source, room_number, guest_name, check_in, check_out, checkin_status')
      .order('room_number', { ascending: true })
      .then(({ data }) => { if (active) { setBookings((data as unknown as Booking[]) || []); setLoading(false) } })
    return () => { active = false }
  }, [])

  // Escape closes the modal. Capture phase + stopPropagation so the inbox-level
  // Escape handler (mobile thread deselect) doesn't also fire.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s
      ? bookings.filter((b) =>
          (b.room_number || '').toLowerCase().includes(s) ||
          (b.guest_name || '').toLowerCase().includes(s) ||
          (b.property_label || '').toLowerCase().includes(s) ||
          String(b.beds24_booking_id || '').includes(s))
      : bookings
    return base.slice(0, 60)
  }, [bookings, q])

  async function link(b: Booking) {
    setLinkingId(b.id); setError(null)
    const { data, error } = await supabase.rpc('link_conversation_to_booking', {
      p_conversation_id: conversationId, p_booking_id: b.id,
    })
    if (error || (data && (data as any).ok === false)) {
      setError((data as any)?.error || error?.message || 'Could not link')
      setLinkingId(null)
      return
    }
    onLinked()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-wa-panel w-full sm:max-w-md sm:rounded-xl rounded-t-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-wa-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="font-medium text-wa-text">Link to a room</div>
            <div className="text-[11px] text-wa-muted truncate">{conversationLabel}</div>
          </div>
          <button onClick={onClose} className="text-wa-muted hover:text-wa-text p-1" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-3 shrink-0">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search room, guest, or booking #"
            className="w-full px-3 py-2 rounded-lg bg-wa-search text-wa-text outline-none placeholder:text-wa-muted" />
        </div>
        {error && <div className="bg-red-900/60 text-red-200 text-xs px-4 py-2">{error}</div>}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <p className="text-wa-muted text-sm p-3">Loading bookings…</p>
          ) : results.length === 0 ? (
            <p className="text-wa-muted text-sm p-3">No matching bookings.</p>
          ) : results.map((b) => (
            <button key={b.id} onClick={() => link(b)} disabled={linkingId !== null}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-wa-hover transition-colors disabled:opacity-50 border-b border-wa-border/30">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-wa-text">Room {b.room_number || '—'}</span>
                {b.property_label && <span className="text-wa-muted text-xs">· {b.property_label}</span>}
                {b.booking_source && <span className="text-[10px] px-1.5 py-0.5 rounded bg-wa-header text-wa-muted">{sourceLabel(b.booking_source)}</span>}
                {linkingId === b.id && <span className="text-[10px] text-wa-green ml-auto">Linking…</span>}
              </div>
              <div className="text-[11px] text-wa-muted mt-0.5 truncate">
                {b.guest_name || 'Guest'}{b.beds24_booking_id ? ` · #${b.beds24_booking_id}` : ''}{b.check_in ? ` · ${b.check_in} → ${b.check_out}` : ''}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
