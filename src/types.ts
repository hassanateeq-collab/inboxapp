export interface Conversation {
  id: string
  connection_id: string | null
  wa_phone: string
  display_name: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_inbound_at: string | null
  unread_count: number
  status: string
  // enriched via v_inbox_conversations
  guest_id: string | null
  booking_id: string | null
  room_number: string | null
  property_id: string | null
  property_code: string | null
  property_label: string | null
  booking_source: string | null
  booking_name: string | null
  beds24_booking_id: number | null
  checkin_status: string | null
  check_in: string | null
  check_out: string | null
  tier: number | null
}

export interface Message {
  id: string
  conversation_id: string
  wa_message_id: string | null
  direction: 'inbound' | 'outbound'
  sender: string | null
  msg_type: string
  body: string | null
  media_url: string | null
  status: string | null
  created_at: string
}

export interface InboxIdentity {
  full_name: string | null
  first_name: string | null
}
