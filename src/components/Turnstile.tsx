import { useEffect, useRef, useState } from 'react'
import { RotateCw, ShieldCheck } from 'lucide-react'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }
let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else { loading = null; script.remove(); reject(new Error('turnstile_unavailable')) }
    }
    script.onerror = () => { loading = null; script.remove(); reject(new Error('turnstile_unavailable')) }
    document.head.appendChild(script)
  })
  return loading
}

export default function Turnstile({ siteKey, resetKey, error, onToken }: {
  siteKey: string
  resetKey: number
  error?: string
  onToken: (token: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    let widgetId: string | null = null
    let api: TurnstileApi | null = null
    callback.current('')
    setFailed(false)
    void loadTurnstile().then((loaded) => {
      if (cancelled || !container.current) return
      api = loaded
      widgetId = api.render(container.current, {
        sitekey: siteKey,
        action: 'sign_petition',
        theme: 'light',
        language: 'fr',
        size: 'flexible',
        callback: (token: string) => { if (!cancelled) { setFailed(false); callback.current(token) } },
        'expired-callback': () => { if (!cancelled) callback.current('') },
        'error-callback': () => { if (!cancelled) { setFailed(true); callback.current('') } },
      })
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (widgetId && api) api.remove(widgetId)
    }
  }, [siteKey, resetKey, retry])

  return (
    <div className="turnstile-field" id="signature-turnstile" tabIndex={-1}>
      <p><ShieldCheck size={14} /> Vérification anti-robot gratuite</p>
      <div ref={container} className="turnstile-widget" />
      {failed && <div className="turnstile-failed" role="status">La vérification ne se charge pas. Vérifiez votre connexion ou votre bloqueur de contenu. <button type="button" className="inline-link" onClick={() => setRetry((value) => value + 1)}><RotateCw size={12} /> Réessayer</button></div>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}
