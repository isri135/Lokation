import { useEffect, useState } from 'react'
import App from './App'
import { SignIn } from './components/SignIn'
import { forgetSession, savedName, signIn, type SignInResult } from './lib/cloud'

type Phase =
  | { kind: 'checking' }
  | { kind: 'signed-out'; error: string | null }
  | { kind: 'ready'; session: SignInResult }

/** Signs in (remembering the last name used in this browser), then shows the app. */
export default function Root() {
  const [phase, setPhase] = useState<Phase>(() =>
    savedName() ? { kind: 'checking' } : { kind: 'signed-out', error: null },
  )

  useEffect(() => {
    const name = savedName()
    if (!name) return
    signIn(name).then(
      (session) => setPhase({ kind: 'ready', session }),
      (err: Error) => setPhase({ kind: 'signed-out', error: err.message }),
    )
  }, [])

  if (phase.kind === 'checking') {
    return (
      <main className="signin">
        <p className="muted">Opening your map…</p>
      </main>
    )
  }

  if (phase.kind === 'signed-out') {
    return (
      <SignIn
        error={phase.error}
        onSubmit={async (name) => {
          try {
            setPhase({ kind: 'ready', session: await signIn(name) })
          } catch (err) {
            setPhase({ kind: 'signed-out', error: (err as Error).message })
          }
        }}
      />
    )
  }

  const { session } = phase
  return (
    <App
      key={session.account.name.toLocaleLowerCase()}
      account={session.account}
      startUnsaved={session.unsaved}
      startedOffline={session.offline}
      onSignOut={() => {
        forgetSession()
        setPhase({ kind: 'signed-out', error: null })
      }}
    />
  )
}
