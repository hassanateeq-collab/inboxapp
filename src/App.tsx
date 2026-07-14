import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import Inbox from './components/Inbox'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="h-full grid place-items-center bg-wa-dark">
        <div className="w-8 h-8 rounded-full border-2 border-wa-border border-t-wa-green animate-spin" role="status" aria-label="Loading" />
      </div>
    )
  }
  if (!session) return <Login />
  return <Inbox session={session} />
}
