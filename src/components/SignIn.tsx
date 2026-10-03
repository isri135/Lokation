import { useState } from 'react'

interface Props {
  onSubmit: (name: string) => Promise<void>
  error: string | null
}

export function SignIn({ onSubmit, error }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim() || busy) return
          setBusy(true)
          try {
            await onSubmit(name)
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1 className="brand signin-brand">
          <span className="brand-mark" aria-hidden="true" />
          Lokation
        </h1>
        <p className="signin-lede">Track the cities you’ve been to and see how much of the world you’ve explored.</p>

        <label className="signin-label" htmlFor="signin-name">
          Your name
        </label>
        <input
          id="signin-name"
          className="signin-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoFocus
          maxLength={40}
          placeholder="e.g. Alex"
          aria-describedby="signin-help"
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn signin-btn" disabled={!name.trim() || busy}>
          {busy ? 'Opening…' : 'Open my map'}
        </button>
        <p id="signin-help" className="signin-help">
          New here? Just type a name to start a map. Names aren’t case-sensitive. There’s no password, so anyone
          who enters your name can see and change your map.
        </p>
      </form>
    </main>
  )
}
