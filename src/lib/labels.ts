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
