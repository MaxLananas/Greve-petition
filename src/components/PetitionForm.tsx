import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, CheckCheck, ChevronDown, Copy, LoaderCircle, LockKeyhole, MessageSquare, PenLine, Share2, ShieldCheck } from 'lucide-react'
import { ApiError, copyText, signPetition } from '../api'
import { ROLE_LABELS } from '../data'
import Turnstile from './Turnstile'
import type { Role, SignatureInput, SignatureResult } from '../types'

const EMPTY_FORM: SignatureInput = {
  firstName: '', lastName: '', email: '', role: '', message: '', consent: false, isPublic: false, website: '',
}

export default function PetitionForm({ onSuccess, onPrivacy, onShare, notify, turnstileSiteKey }: {
  onSuccess: (result: SignatureResult) => void
  onPrivacy: () => void
  onShare: () => void
  notify: (message: string) => void
  turnstileSiteKey?: string | null
}) {
  const [values, setValues] = useState<SignatureInput>({ ...EMPTY_FORM })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [success, setSuccess] = useState<SignatureResult | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)

  function update<K extends keyof SignatureInput>(field: K, value: SignatureInput[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const fieldErrors: Record<string, string> = {}
    if (!values.firstName.trim()) fieldErrors.firstName = 'Votre prénom est nécessaire.'
    if (!values.lastName.trim()) fieldErrors.lastName = 'Votre nom est nécessaire.'
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.email.trim())) fieldErrors.email = 'Indiquez une adresse e-mail valide.'
    if (!values.consent) fieldErrors.consent = 'Votre accord est nécessaire pour signer.'
    if (turnstileSiteKey && !turnstileToken) fieldErrors.turnstile = 'Validez la vérification anti-robot avant de signer.'
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors)
      setError('Il reste quelques informations à vérifier.')
      document.getElementById(`signature-${Object.keys(fieldErrors)[0]}`)?.focus()
      return
    }
    setPending(true)
    setError('')
    setErrors({})
    try {
      const result = await signPetition({ ...values, turnstileToken })
      setSuccess(result)
      setValues({ ...EMPTY_FORM })
      onSuccess(result)
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fields)
        setError(caught.message)
        document.getElementById(`signature-${Object.keys(caught.fields)[0]}`)?.focus()
      } else {
        setError('Une erreur est survenue. Votre signature n’a pas été confirmée. Merci de réessayer.')
      }
    } finally {
      setPending(false)
      if (turnstileSiteKey) { setTurnstileToken(''); setTurnstileReset((value) => value + 1) }
    }
  }

  async function copyCode() {
    if (!success) return
    try {
      await copyText(success.withdrawalCode)
      setCodeCopied(true)
      notify('Votre référence privée a été copiée. Conservez-la en lieu sûr.')
    } catch {
      notify('Sélectionnez votre référence ci-dessous pour la copier.')
    }
  }

  if (success) {
    return (
      <div className="signature-card signature-success" role="status" aria-live="polite">
        <div className="form-eyebrow"><CheckCheck size={17} /> SIGNATURE ENREGISTRÉE</div>
        <div className="success-body">
          <div className="success-check"><Check size={42} strokeWidth={1.7} /></div>
          <h3>Merci, {success.firstName} !<br /><span>Votre voix compte.</span></h3>
          <p>{success.count === 1 ? <>Vous êtes la <strong>première personne à soutenir</strong> cette pétition.</> : <>Vous faites maintenant partie des <strong>{success.count.toLocaleString('fr-FR')} personnes qui soutiennent</strong> la mobilisation.</>}</p>
          <p>Ensemble, faisons entendre les revendications de notre lycée.</p>
          <button className="button button-yellow button-full" type="button" onClick={onShare}><Share2 size={18} /> Je partage la pétition <ArrowRight size={19} /></button>
          <div className="receipt">
            <strong><LockKeyhole size={14} /> Votre référence privée</strong>
            <p>Conservez-la : elle vous permet de retirer votre signature à tout moment, depuis le bas du site.</p>
            <div className="receipt-code"><code>{success.withdrawalCode}</code><button type="button" className="icon-button" onClick={copyCode} aria-label="Copier ma référence privée">{codeCopied ? <Check size={17} /> : <Copy size={17} />}</button></div>
          </div>
          <span className="success-note"><ShieldCheck size={15} /> Vos coordonnées restent privées.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="signature-card">
      <div className="form-eyebrow"><PenLine size={17} /> JE SOUTIENS LA MOBILISATION</div>
      <form onSubmit={submit} noValidate aria-busy={pending}>
        <div className="form-heading"><h3>Je signe la pétition.</h3><p>Un petit geste. Une vraie force collective.</p></div>
        <fieldset disabled={pending}>
          <legend className="sr-only">Vos informations pour signer la pétition</legend>
          <div className="form-row">
            <div className="field"><label htmlFor="signature-firstName">Prénom <span>*</span></label><input id="signature-firstName" name="firstName" autoComplete="given-name" placeholder="Votre prénom" value={values.firstName} onChange={(e) => update('firstName', e.target.value)} maxLength={80} required aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? 'error-firstName' : undefined} />{errors.firstName && <p id="error-firstName" className="field-error">{errors.firstName}</p>}</div>
            <div className="field"><label htmlFor="signature-lastName">Nom <span>*</span></label><input id="signature-lastName" name="lastName" autoComplete="family-name" placeholder="Votre nom" value={values.lastName} onChange={(e) => update('lastName', e.target.value)} maxLength={80} required aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? 'error-lastName' : undefined} />{errors.lastName && <p id="error-lastName" className="field-error">{errors.lastName}</p>}</div>
          </div>
          <div className="field"><label htmlFor="signature-email">Adresse e-mail <span>*</span><span className="label-private"><LockKeyhole size={11} /> reste privée</span></label><input id="signature-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="vous@exemple.fr" value={values.email} onChange={(e) => update('email', e.target.value)} maxLength={254} required aria-invalid={!!errors.email} aria-describedby={errors.email ? 'error-email' : undefined} />{errors.email && <p id="error-email" className="field-error">{errors.email}</p>}</div>
          <div className="field"><label htmlFor="signature-role">Je suis… <span className="label-optional">(facultatif)</span></label><div className="select-wrap"><select id="signature-role" name="role" value={values.role} onChange={(e) => update('role', e.target.value as Role)} aria-invalid={!!errors.role}><option value="">Choisissez votre profil</option>{Object.entries(ROLE_LABELS).filter(([key]) => key).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={17} /></div>{errors.role && <p className="field-error">{errors.role}</p>}</div>
          <button type="button" className="message-toggle" aria-expanded={messageOpen} aria-controls="signature-message-area" onClick={() => setMessageOpen(!messageOpen)}><MessageSquare size={15} /> Ajouter un message de soutien <span>(facultatif)</span><ChevronDown size={15} className={messageOpen ? 'rotate' : ''} /></button>
          {messageOpen && <div className="field message-field" id="signature-message-area"><label htmlFor="signature-message" className="sr-only">Votre message de soutien privé</label><textarea id="signature-message" name="message" rows={3} maxLength={1000} placeholder="Un mot pour l’équipe de la mobilisation…" value={values.message} onChange={(e) => update('message', e.target.value)} aria-invalid={!!errors.message} /><small>Votre message reste privé. {values.message.length}/1 000 caractères.</small>{errors.message && <p className="field-error">{errors.message}</p>}</div>}
          <div className="form-checks">
            <label className={`checkbox-label ${errors.consent ? 'checkbox-invalid' : ''}`} htmlFor="signature-consent"><input id="signature-consent" name="consent" type="checkbox" checked={values.consent} onChange={(e) => update('consent', e.target.checked)} required aria-invalid={!!errors.consent} aria-describedby={errors.consent ? 'error-consent' : undefined} /><span>Je soutiens les revendications et j’accepte l’utilisation de mes données pour cette pétition. <button type="button" className="inline-link" onClick={onPrivacy}>Confidentialité</button> <span className="required">*</span></span></label>
            {errors.consent && <p id="error-consent" className="field-error">{errors.consent}</p>}
            <label className="checkbox-label" htmlFor="signature-isPublic"><input id="signature-isPublic" name="isPublic" type="checkbox" checked={values.isPublic} onChange={(e) => update('isPublic', e.target.checked)} /><span>Afficher mon prénom et l’initiale de mon nom parmi les soutiens.</span></label>
          </div>
          <div className="honey-field" aria-hidden="true"><label htmlFor="signature-website">Ne pas remplir ce champ</label><input id="signature-website" name="website" autoComplete="off" tabIndex={-1} value={values.website} onChange={(e) => update('website', e.target.value)} /></div>
          {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} resetKey={turnstileReset} error={errors.turnstile} onToken={(token) => {
            setTurnstileToken(token)
            if (token) setErrors((current) => ({ ...current, turnstile: '' }))
          }} />}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-yellow button-full submit-button" type="submit" disabled={pending}>{pending ? <LoaderCircle size={19} className="spin" /> : <PenLine size={18} />}{pending ? 'Enregistrement en cours…' : 'Je signe la pétition'}{!pending && <ArrowRight size={20} />}</button>
        </fieldset>
        <p className="form-security"><ShieldCheck size={14} /> Pas de compte. Pas de publicité. Juste votre soutien.</p>
        <p className="form-required">* Champs obligatoires · Une signature par adresse e-mail.</p>
      </form>
    </div>
  )
}
