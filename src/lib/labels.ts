// Friendly labels for the booking source enum (bookings.source).
export const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct',
  booking_com: 'Booking.com',
  walk_in: 'Walk-in',
  whatsapp: 'WhatsApp',
  corporate: 'Corporate',
  phone: 'Phone',
  website: 'Website',
  other: 'Other',
}

export function sourceLabel(s: string | null | undefined): string {
  if (!s) return ''
  return SOURCE_LABELS[s] || s
}

// Digits-only phone, for wa.me links and de-duplication.
export function digits(s: string | null | undefined): string {
  return (s || '').replace(/[^0-9]/g, '')
}

// Deterministic avatar color per contact (WhatsApp-style colored initials).
export function avatarColor(seed: string | null | undefined): string {
  const s = seed || '?'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `hsl(${h}, 38%, 42%)`
}
