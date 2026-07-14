import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="h-full grid place-items-center bg-wa-dark px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-wa-panel rounded-xl p-6 border border-wa-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-wa-green grid place-items-center text-black font-bold text-lg">H</div>
          <div>
            <h1 className="text-wa-text font-semibold leading-tight">Hamsun Inbox</h1>
            <p className="text-wa-muted text-xs">WhatsApp business messages</p>
          </div>
        </div>
        <label className="block text-wa-muted text-xs mb-1">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoFocus
          className="w-full mb-3 px-3 py-2 rounded bg-wa-search text-wa-text outline-none border border-wa-border focus:border-wa-green" />
        <label className="block text-wa-muted text-xs mb-1">Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
          className="w-full mb-4 px-3 py-2 rounded bg-wa-search text-wa-text outline-none border border-wa-border focus:border-wa-green" />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button disabled={busy} className="w-full py-2 rounded bg-wa-green text-black font-medium disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-wa-muted text-[11px] mt-4 text-center">Use your Hamsun PMS staff login.</p>
      </form>
    </div>
  )
}
