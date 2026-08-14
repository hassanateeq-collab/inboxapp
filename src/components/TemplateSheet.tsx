import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { windowInfo, type Conversation, type InboxTemplate } from '../types'

// Manual template picker (Hassan 2026-08-14). Rows come from whatsapp-send list_templates
// with variables prefilled server-side (guest, room, property, breakfast portal code).
// Gray-out rules are SERVER-enforced; this sheet only mirrors sendable_now:
//   APPROVED Meta template  -> sendable any time (in-window delivers free, out as paid template)
//   freeform / not approved -> only while the guest's 24h window is open.
export default function TemplateSheet({
  conversation, onClose, onSent,
}: {
  conversation: Conversation
  onClose: () => void
  onSent: (info: string) => void
}) {
  const [templates, setTemplates] = useState<InboxTemplate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const winOpen = windowInfo(conversation).open

  useEffect(() => {
    let active = true
    supabase.functions
      .invoke('whatsapp-send', { body: { action: 'list_templates', conversation_id: conversation.id } })
      .then(({ data, error }) => {
        if (!active) return
        const errMsg = (data as any)?.error || error?.message
        if (errMsg) { setLoadError(String(errMsg)); return }
        setTemplates(((data as any)?.templates || []) as InboxTemplate[])
      })
      .catch((e) => { if (active) setLoadError(e?.message || 'Failed to load templates') })
    return () => { active = false }
  }, [conversation.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function preview(t: InboxTemplate): string {
    const typed = inputs[t.logical_key]
    return (t.body_text || '').replace(/\{\{(\d+)\}\}/g, (_m, n) => {
      const v = t.variables.find((x) => x.n === Number(n))
      if (v?.needs_input) return typed?.trim() ? typed : `[${v.label || 'your message'}]`
      return v?.value || `[${v?.label || 'var ' + n}]`
    })
  }

  function tagFor(t: InboxTemplate): { label: string; cls: string } {
    if (!t.sendable_now) {
      return t.send_kind === 'freeform'
        ? { label: 'Window closed', cls: 'bg-wa-header text-wa-muted' }
        : { label: 'Awaiting Meta approval', cls: 'bg-wa-header text-wa-muted' }
    }
    if (t.send_kind === 'freeform') return { label: 'Free · window open', cls: 'bg-sky-500/15 text-sky-400' }
    return { label: 'Approved', cls: 'bg-wa-green/15 text-wa-green' }
  }

  async function send(t: InboxTemplate) {
    const need = t.variables.find((v) => v.needs_input)
    const typed = (inputs[t.logical_key] || '').trim()
    if (need && !typed) {
      setRowError((p) => ({ ...p, [t.logical_key]: 'Type the message first.' }))
      return
    }
    setRowError((p) => ({ ...p, [t.logical_key]: '' }))
    setSendingKey(t.logical_key)
    try {
      const body: Record<string, unknown> = {
        action: 'send_template',
        conversation_id: conversation.id,
        template_key: t.logical_key,
      }
      if (need && typed) body.inputs = { [String(need.n)]: typed }
      const { data, error } = await supabase.functions.invoke('whatsapp-send', { body })
      const errMsg = (data as any)?.error || error?.message
      if (errMsg) throw new Error(String(errMsg))
      onSent((data as any)?.via === 'freeform'
        ? 'Template sent free-form (window open) — the guest received the full message at no cost.'
        : 'Sent as an approved template (small template fee).')
      onClose()
    } catch (e: any) {
      setRowError((p) => ({ ...p, [t.logical_key]: e?.message || 'Send failed' }))
    } finally {
      setSendingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-wa-panel border border-wa-border w-full md:max-w-xl max-h-[82vh] rounded-t-2xl md:rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center justify-between border-b border-wa-border/60 shrink-0">
          <div className="min-w-0">
            <div className="font-semibold">Send a template</div>
            <div className="text-xs text-wa-muted truncate">
              {winOpen
                ? 'Window open — everything is available and delivers free.'
                : 'Window closed — only approved templates can be sent; grayed items unlock when the guest next messages.'}
            </div>
          </div>
          <button onClick={onClose} className="text-wa-muted hover:text-wa-text p-1 shrink-0" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-2.5">
          {loadError && <p className="text-red-400 text-sm px-1">{loadError}</p>}
          {!templates && !loadError && <p className="text-wa-muted text-sm px-1">Loading templates…</p>}
          {templates?.length === 0 && <p className="text-wa-muted text-sm px-1">No templates configured.</p>}
          {templates?.map((t) => {
            const tag = tagFor(t)
            const disabled = !t.sendable_now || !t.ready
            const need = t.variables.find((v) => v.needs_input)
            return (
              <div key={t.logical_key} className={`rounded-xl border border-wa-border/60 bg-wa-header p-3 ${disabled ? 'opacity-45' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm capitalize flex-1 truncate">{t.logical_key.replace(/_/g, ' ')}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${tag.cls}`}>{tag.label}</span>
                </div>
                <p className="text-xs text-wa-muted whitespace-pre-wrap mt-2 bg-wa-dark/60 rounded-lg p-2.5">{preview(t)}</p>
                {need && !disabled && (
                  <textarea
                    value={inputs[t.logical_key] || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [t.logical_key]: e.target.value }))}
                    placeholder={need.label || 'Your message'}
                    rows={2}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-wa-search text-wa-text text-sm outline-none placeholder:text-wa-muted resize-none"
                  />
                )}
                {rowError[t.logical_key] && <p className="text-red-400 text-xs mt-1.5">{rowError[t.logical_key]}</p>}
                <button
                  onClick={() => send(t)}
                  disabled={disabled || sendingKey !== null}
                  className="mt-2.5 px-4 py-1.5 rounded-lg bg-wa-green text-black text-xs font-semibold disabled:opacity-50"
                >
                  {sendingKey === t.logical_key ? 'Sending…' : disabled ? (t.sendable_now ? 'Missing data' : 'Locked') : 'Send'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
