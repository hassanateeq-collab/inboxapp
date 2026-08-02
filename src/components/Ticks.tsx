const READ_TICK_COLOR = '#53bdeb'

export function ClockGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.2" aria-label="Sending">
      <circle cx="6" cy="6" r="4.7" />
      <path d="M6 3.6V6l1.7 1.1" strokeLinecap="round" />
    </svg>
  )
}

// sending -> clock, sent -> single check, delivered -> double check, read -> double check (blue), failed -> red !
export function Ticks({ status }: { status: string | null }) {
  if (!status) return null
  if (status === 'sending' || status === 'pending') return <ClockGlyph />
  if (status === 'failed' || status === 'error') {
    return <span className="text-red-400 font-semibold leading-none" aria-label="Failed">!</span>
  }
  const read = status === 'read'
  const double = read || status === 'delivered'
  return (
    <svg
      viewBox="0 0 18 12"
      className="w-[16px] h-[11px] shrink-0"
      fill="none"
      stroke={read ? READ_TICK_COLOR : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={status}
    >
      <path d="M1.5 6.5l3 3L11 2.5" />
      {double && <path d="M7.5 6.5l3 3L17 2.5" />}
    </svg>
  )
}
