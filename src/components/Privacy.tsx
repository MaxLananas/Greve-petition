import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { ApiError, withdrawSignature } from '../api'

export function PrivacyContent({ onWithdraw }: { onWithdraw: () => void }) {
  return (
    <div className="privacy-content">
      <p className="modal-intro">Votre soutien est important. Votre vie privée l’est aussi.</p>
      <div className="privacy-callout"><ShieldCheck size={23} /><p><strong>Pas de publicité ni de suivi.</strong><br />Ce site n’utilise ni cookies publicitaires, ni outils de suivi marketing, ni stockage de vos coordonnées dans votre navigateur.</p></div>
      <h3>À quoi servent vos informations ?</h3>
      <p>Votre prénom, votre nom et votre adresse e-mail servent à enregistrer votre soutien et à limiter les doublons. Le profil et le message de soutien sont facultatifs. Votre accord est enregistré avec la date de signature.</p>
      <p>Les signatures sont destinées à appuyer les revendications du collectif Leborgne en Action auprès de l’établissement et des autorités compétentes. Les coordonnées ne sont ni vendues, ni utilisées à des fins publicitaires.</p>
      <h3>Que peut-on voir sur le site ?</h3>
      <p>Uniquement votre prénom, l’initiale de votre nom, votre profil et la date de signature, <strong>si vous cochez l’option d’affichage public</strong>. Votre nom complet, votre e-mail et votre message ne sont jamais exposés par l’API publique.</p>
      <h3>Hébergement et protection anti-robot</h3>
      <p>Les signatures sont conservées dans une base de données privée, accessible uniquement au serveur de la pétition. Le site peut utiliser Turnstile pour limiter les robots : Cloudflare traite alors des informations techniques de connexion et du navigateur pour cette vérification, et non à des fins publicitaires. <a className="inline-link" href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Politique de confidentialité de Cloudflare</a>.</p>
      <h3>Qui gère les signatures ?</h3>
      <p>L’équipe organisatrice de Leborgne en Action gère cette pétition. Les informations complètes sont réservées à cette équipe via un export protégé. Elle est responsable de leur conservation pendant la mobilisation et de leur suppression à sa clôture.</p>
      <p>Pour toute demande concernant vos données, écrivez à maxenceponche971@gmail.com.</p>
      <h3>Vous gardez le choix.</h3>
      <p>Après la signature, une référence privée vous est remise. Conservez-la pour retirer votre signature et supprimer les données associées à tout moment. Ce retrait met également à jour le compteur.</p>
      <p>Le retrait supprime les données de la base active. Des copies peuvent subsister dans les sauvegardes de l’hébergeur jusqu’à leur expiration : jusqu’à sept jours pour la récupération D1 sur le plan gratuit.</p>
      <button className="button button-outline" type="button" onClick={onWithdraw}><LockKeyhole size={17} /> Retirer ma signature <ArrowRight size={17} /></button>
      <p className="privacy-footnote">Pétition 2026–2027 · Initiative de la mobilisation Leborgne en Action, indépendante du site officiel de l’établissement.</p>
    </div>
  )
}

export function WithdrawForm({ onWithdraw }: { onWithdraw: (result: { count: number; goal: number }) => void }) {
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    try {
      const result = await withdrawSignature(code.trim())
      setDone(true)
      setCode('')
      onWithdraw(result)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Une erreur est survenue. Réessayez dans quelques instants.')
    } finally {
      setPending(false)
    }
  }

  if (done) return <div className="withdraw-success" role="status"><CheckCircle2 size={44} /><h3>Votre signature a été retirée.</h3><p>Les données associées ont été supprimées et le compteur a été mis à jour. Merci d’avoir pris part à la mobilisation.</p></div>

  return (
    <form className="withdraw-form" onSubmit={submit}>
      <p className="modal-intro">Vous pouvez retirer votre soutien quand vous le souhaitez.</p>
      <p>Entrez la référence privée remise lors de votre signature. Le retrait supprime vos coordonnées et votre éventuel message. Cette action est définitive.</p>
      <div className="field"><label htmlFor="withdrawal-code">Votre référence de signature</label><input id="withdrawal-code" name="withdrawalCode" type="text" value={code} onChange={(e) => { setCode(e.target.value); setError('') }} placeholder="Votre référence de 32 caractères" autoComplete="off" spellCheck={false} required minLength={32} maxLength={32} aria-invalid={!!error} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-navy button-full" type="submit" disabled={pending}>{pending ? <LoaderCircle size={18} className="spin" /> : <LockKeyhole size={18} />}{pending ? 'Retrait en cours…' : 'Retirer définitivement ma signature'}<ArrowRight size={18} /></button>
    </form>
  )
}
