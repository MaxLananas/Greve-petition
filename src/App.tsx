import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, Coffee, DoorOpen, Dumbbell, FileText, GraduationCap, HeartHandshake, LockKeyhole, MapPin, Menu, Minus, Monitor, Plus, Share2, ShieldCheck, Sparkles, ThermometerSun, UsersRound, Utensils, X } from 'lucide-react'
import { copyText, getPetition } from './api'
import { FAQS, PDF_URL, PRIORITIES, ROLE_LABELS } from './data'
import { Brand, BrandShapes, CampaignPoster, ColorStripe } from './components/Brand'
import Dialog from './components/Dialog'
import PetitionForm from './components/PetitionForm'
import { PrivacyContent, WithdrawForm } from './components/Privacy'
import type { PetitionData, Priority, Role, SignatureResult } from './types'

const formatNumber = (number: number) => number.toLocaleString('fr-FR')
const ICONS = { meals: Utensils, heat: ThermometerSun, cafe: Coffee, computer: Monitor, hygiene: Sparkles, sport: Dumbbell, gate: DoorOpen }
const FILTERS: { key: 'all' | Role; label: string }[] = [
  { key: 'all', label: 'Tous les soutiens' },
  { key: 'eleve', label: 'Lycéens' },
  { key: 'personnel', label: 'Personnels' },
  { key: 'parent', label: 'Parents' },
  { key: 'soutien', label: 'Citoyens' },
]

function Progress({ data, compact = false }: { data: PetitionData | null; compact?: boolean }) {
  const count = data?.count ?? null
  const goal = data?.goal ?? 1000
  const percentage = count === null ? 0 : Math.min(Math.round(count / goal * 100), 100)
  return (
    <div className={`petition-progress ${compact ? 'progress-compact' : ''}`}>
      <div className="progress-top"><div><strong>{count === null ? '—' : formatNumber(count)}</strong><span>{count === 1 ? 'voix réunie' : 'voix réunies'}</span></div><span className="live-label"><span /> {count === null ? 'Chargement' : 'Chaque voix compte'}</span></div>
      <div className="progress-track" role="progressbar" aria-label="Signatures de la pétition" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={count === null ? undefined : Math.min(count, goal)} aria-valuetext={count === null ? 'Chargement du compteur' : `${count} signatures, premier cap de ${goal}`}><span style={{ width: `${percentage}%` }} /></div>
      <div className="progress-bottom"><span>Premier cap : <strong>{formatNumber(goal)} signatures</strong></span><span>{count === null ? '—' : `${percentage} %`}</span></div>
    </div>
  )
}

function PriorityCard({ priority, onOpen }: { priority: Priority; onOpen: () => void }) {
  const Icon = ICONS[priority.icon]
  return (
    <article className={`priority-card priority-${priority.color}`}>
      <div className="priority-top"><span className="priority-number">{priority.number}</span><span className="priority-icon"><Icon size={24} strokeWidth={1.6} /></span></div>
      <h3>{priority.title}</h3>
      <p>{priority.description}</p>
      <button type="button" className="priority-link" onClick={onOpen} aria-label={`Découvrir la demande : ${priority.title}`}>Voir la demande <ArrowUpRight size={17} /></button>
    </article>
  )
}

export default function App() {
  const [data, setData] = useState<PetitionData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('')
  const [modal, setModal] = useState<Priority | 'privacy' | 'withdraw' | null>(null)
  const [faqOpen, setFaqOpen] = useState<number | null>(0)
  const [supportFilter, setSupportFilter] = useState<'all' | Role>('all')
  const [supportLimit, setSupportLimit] = useState(8)
  const [toast, setToast] = useState('')
  const [signed, setSigned] = useState(false)
  const [formEpoch, setFormEpoch] = useState(0)
  const [showMobileSign, setShowMobileSign] = useState(true)
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadController = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    try {
      const result = await getPetition(controller.signal)
      setData(result)
      setLoadError(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), 60_000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      loadController.current?.abort()
      window.removeEventListener('focus', onFocus)
      if (toastTimeout.current) clearTimeout(toastTimeout.current)
    }
  }, [refresh])

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setShowMobileSign(!entry.isIntersecting), { threshold: 0 })
    const target = document.getElementById('signature-panel')
    if (target) observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActiveNav(entry.target.id)
    }, { rootMargin: '-20% 0px -55% 0px', threshold: 0 })
    for (const id of ['mobilisation', 'revendications', 'soutiens']) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimeout.current) clearTimeout(toastTimeout.current)
    toastTimeout.current = setTimeout(() => setToast(''), 5000)
  }, [])

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}`
    const text = 'Étudier. Dignement. Soutenez la pétition de Leborgne en Action pour des conditions d’étude dignes au lycée Yves Leborgne, en Guadeloupe.'
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Leborgne en Action — Étudier. Dignement.', text, url })
      } else {
        await copyText(url)
        notify('Le lien de la pétition a été copié. À vous de faire passer le mot !')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify('Pour partager la pétition, copiez le lien dans la barre d’adresse de votre navigateur.')
    }
  }

  function onSignature(result: SignatureResult) {
    setData((current) => current ? { ...current, count: result.count, goal: result.goal } : {
      count: result.count, goal: result.goal, publicCount: 0, supporters: [], contactEmail: null,
    })
    setSigned(true)
    void refresh()
  }

  function onWithdraw(result: { count: number; goal: number }) {
    setData((current) => current ? { ...current, count: result.count, goal: result.goal } : current)
    setFormEpoch((current) => current + 1)
    setSigned(false)
    void refresh()
  }

  const supporters = (data?.supporters ?? []).filter((supporter) => supportFilter === 'all' || supporter.role === supportFilter)
  const navLink = (id: string, label: string) => <a href={`#${id}`} className={activeNav === id ? 'active' : ''} onClick={() => { setMenuOpen(false); setActiveNav(id) }}>{label}</a>

  return (
    <>
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav id="mobile-navigation" className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Navigation principale">
            {navLink('mobilisation', 'La mobilisation')}{navLink('revendications', 'Nos revendications')}{navLink('soutiens', 'Les soutiens')}
            <a className="mobile-nav-sign" href="#signer" onClick={() => setMenuOpen(false)}>Je signe la pétition <ArrowUpRight size={17} /></a>
          </nav>
          <div className="header-actions"><a className="button button-yellow header-sign" href="#signer">Je signe la pétition <ArrowUpRight size={17} /></a><button className="icon-button menu-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation">{menuOpen ? <X size={23} /> : <Menu size={24} />}</button></div>
        </div>
      </header>

      <main id="contenu">
        <section className="hero" id="accueil" aria-labelledby="hero-title">
        <div className="shape-float yellow ellipse" aria-hidden="true" />
        <div className="shape-float blue arc" aria-hidden="true" />
        <div className="shape-float dark half" aria-hidden="true" />
          <div className="container hero-inner">
            <div className="hero-copy">
              <div className="campaign-badge"><span /> MOBILISATION LYCÉENNE <span className="badge-year">2026—2027</span></div>
              <h1 id="hero-title">ÉTUDIER.<br /><span className="title-highlight">DIGNEMENT.</span></h1>
              <p className="hero-description">Nos conditions d’étude méritent<br className="desktop-break" /> des réponses à la hauteur de notre avenir.</p>
              <p className="hero-location"><MapPin size={15} strokeWidth={1.7} /> Lycée Yves Leborgne <span>·</span> Sainte-Anne, Guadeloupe</p>
              <div className="hero-cta"><a className="button button-yellow button-large" href="#signer">Je fais entendre ma voix <ArrowUpRight size={20} /></a><a className="hero-secondary" href="#revendications">Nos revendications <ArrowDown size={16} /></a></div>
              <div className="hero-community"><div className="community-icons" aria-hidden="true"><span><GraduationCap size={17} strokeWidth={1.7} /></span><span><UsersRound size={17} strokeWidth={1.7} /></span><span><HeartHandshake size={17} strokeWidth={1.7} /></span></div><p>Lycéens, enseignants, parents, citoyens.<br /><strong>Une mobilisation qui nous rassemble.</strong></p></div>
            </div>
            <CampaignPoster />
          </div>
          <div className="hero-bottom"><div className="container"><span><span className="live-dot" /> La pétition est ouverte</span><a href="#signer"><strong>{data ? formatNumber(data.count) : '—'}</strong> {data?.count === 1 ? 'voix réunie' : 'voix réunies'} <ArrowUpRight size={15} /></a><span className="hero-bottom-note"><LockKeyhole size={13} /> Vos coordonnées restent privées.</span></div></div>
        </section>

        <div className="slogan-band" aria-label="Une voix. Plusieurs forces. Une même action."><div className="container"><span>UNE VOIX.</span><span className="slogan-separator yellow" /><span>PLUSIEURS FORCES.</span><span className="slogan-separator green" /><span>UNE MÊME ACTION.</span><span className="slogan-separator blue" /></div></div>

        <section className="section intro-section" id="mobilisation" aria-labelledby="intro-title">
          <div className="container">
            <p className="eyebrow"><span>01</span> NOTRE MOBILISATION</p>
            <div className="intro-grid"><div><h2 id="intro-title">Ce n’est pas du confort.<br /><span>C’est notre quotidien.</span></h2><p className="intro-subtitle">Notre lycée. Notre voix. Notre action.</p><div className="mobilisation-values"><span><Check size={14} /> Collective</span><span><Check size={14} /> Calme et digne</span><span><Check size={14} /> Sans violence</span></div></div><div className="intro-body"><p>Apprendre dans des salles surchauffées. Manger sans avoir le choix. Travailler avec du matériel en panne. <strong>Ce n’est pas la scolarité que nous voulons.</strong></p><p>Au lycée Yves Leborgne, les lycéens et les enseignants portent des revendications communes pour des conditions d’étude dignes. Cette pétition donne du poids à notre voix collective.</p><div className="evidence-row"><div><strong>33 <span>°C</span></strong><span>relevés signalés dans une salle</span></div><div><strong>7 <span>/ 14</span></strong><span>ordinateurs fonctionnels au CDI</span></div></div><p className="evidence-source">Constats rapportés dans le dossier transmis. <a href={PDF_URL} target="_blank" rel="noreferrer">Lire les précisions <ArrowUpRight size={11} /></a></p></div></div>
          </div>
        </section>

        <section className="section priorities-section" id="revendications" aria-labelledby="priorities-title">
          <div className="container">
            <div className="section-heading"><div><p className="eyebrow"><span>02</span> NOS REVENDICATIONS</p><h2 id="priorities-title">7 priorités.<br /><span>Un même objectif.</span></h2></div><div className="section-heading-aside"><p>Des demandes concrètes pour apprendre<br />et vivre dignement au lycée.</p><a className="text-link" href={PDF_URL} target="_blank" rel="noreferrer"><FileText size={16} /> Lire le dossier complet <ArrowUpRight size={17} /></a></div></div>
            <div className="priorities-grid">{PRIORITIES.map((priority) => <PriorityCard key={priority.id} priority={priority} onOpen={() => setModal(priority)} />)}<a className="dossier-card" href={PDF_URL} download="Revendications-Leborgne-en-Action-2026-2027.pdf"><svg className="dossier-art" viewBox="0 0 120 130" fill="none" aria-hidden="true"><path d="M60 0C93 0 120 27 120 60C120 93 93 120 60 120V0Z" fill="#FFC72C" /><path d="M0 130C0 97 27 70 60 70V130H0Z" fill="#009444" /></svg><span className="dossier-icon"><FileText size={25} strokeWidth={1.6} /></span><h3>Tout est<br />dans le dossier.</h3><p>Les constats. Les demandes.<br />Notre vision pour le lycée.</p><span className="dossier-download">Télécharger le PDF <ArrowDownToLine size={17} /></span><small>ÉDITION ENRICHIE · 9 PAGES</small></a></div>
            <p className="priorities-note"><ShieldCheck size={16} /> Et aussi : bâtiments, sécurité, santé et avenir scolaire. <a href={PDF_URL} target="_blank" rel="noreferrer">Toutes nos revendications dans le dossier <ArrowUpRight size={13} /></a></p>
          </div>
        </section>

        <section className="signature-section" id="signer" aria-labelledby="signature-title">
          <div className="container signature-grid"><div className="signature-copy"><p className="eyebrow"><span>03</span> À VOUS DE JOUER</p><h2 id="signature-title">VOTRE VOIX<br /><span>COMPTE.</span></h2><p className="signature-description">Un lycée digne, c’est l’affaire de tous.<br />En signant, vous soutenez les revendications<br className="desktop-break" /> des lycéens et des enseignants.</p><Progress data={data} />{loadError && <div className="counter-error" role="status">Le compteur est momentanément indisponible. <button className="inline-link" type="button" onClick={() => void refresh()}>Réessayer</button></div>}<div className="signature-promises"><p><span><Check size={15} /></span>Une minute pour faire la différence.</p><p><span><Check size={15} /></span>Votre e-mail ne sera jamais public.</p><p><span><Check size={15} /></span>Votre soutien, sans créer de compte.</p></div><div className="signature-quote"><UsersRound size={26} strokeWidth={1.5} /><p>« Notre voix. Notre force.<br /><strong>Notre action. »</strong></p></div><BrandShapes className="signature-shapes" /></div><div id="signature-panel"><PetitionForm key={formEpoch} onSuccess={onSignature} onPrivacy={() => setModal('privacy')} onShare={() => void share()} notify={notify} turnstileSiteKey={data?.turnstileSiteKey} /></div></div>
        </section>

        <section className="section supporters-section" id="soutiens" aria-labelledby="supporters-title">
          <div className="container"><div className="section-heading supporters-heading"><div><p className="eyebrow"><span>04</span> LA FORCE DU COLLECTIF</p><h2 id="supporters-title">Des voix qui se rassemblent.</h2><p className="section-description">Chaque signature renforce notre mobilisation.</p></div><button type="button" className="button button-outline" onClick={() => void share()}><Share2 size={17} /> Faire passer le mot <ArrowUpRight size={17} /></button></div><div className="supporters-toolbar"><div className="supporter-filters" aria-label="Filtrer les soutiens par profil">{FILTERS.map((filter) => <button type="button" key={filter.key} className={supportFilter === filter.key ? 'selected' : ''} aria-pressed={supportFilter === filter.key} onClick={() => { setSupportFilter(filter.key); setSupportLimit(8) }}>{filter.label}</button>)}</div><span className="public-count"><span className="live-dot" /> {data ? formatNumber(data.count) : '—'} {data?.count === 1 ? 'signature' : 'signatures'}</span></div>
            {supporters.length > 0 ? <><ul className="supporters-grid">{supporters.slice(0, supportLimit).map((supporter, index) => <li className="supporter-card" key={`${supporter.createdAt}-${index}`}><span className={`supporter-avatar avatar-${index % 4}`}>{Array.from(supporter.firstName)[0]?.toUpperCase()}</span><div><h3>{supporter.firstName} {supporter.lastInitial}.</h3><p>{ROLE_LABELS[supporter.role] ?? 'Soutien'}</p></div><time dateTime={supporter.createdAt}>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'America/Guadeloupe' }).format(new Date(supporter.createdAt))}</time></li>)}</ul>{supporters.length > supportLimit && <button type="button" className="button button-outline load-more" onClick={() => setSupportLimit((current) => current + 8)}>Voir plus de soutiens <ChevronDown size={17} /></button>}<p className="supporters-privacy"><LockKeyhole size={13} /> Les 50 derniers soutiens ayant choisi d’apparaître. Les autres signatures sont aussi comptabilisées.</p></> : <div className="supporters-empty"><div className="empty-illustration" aria-hidden="true"><span /><span><UsersRound size={32} strokeWidth={1.5} /></span><span /></div><div><h3>{loadError ? 'Les soutiens sont momentanément indisponibles.' : (data?.publicCount ?? 0) > 0 ? 'Pas encore de soutien public dans cette catégorie.' : (data?.count ?? 0) > 0 ? 'Des voix réunies, en toute discrétion.' : 'La première voix pourrait être la vôtre.'}</h3><p>{loadError ? 'Réessayez dans quelques instants pour afficher le compteur et les soutiens.' : (data?.count ?? 0) > 0 ? 'L’affichage public est facultatif. Chaque signature compte, visible ou non.' : 'La mobilisation commence avec nous. Ajoutez votre voix au collectif.'}</p></div><a className="text-link" href="#signer">Je rejoins le mouvement <ArrowUpRight size={17} /></a></div>}
          </div>
        </section>

        <section className="section faq-section" id="questions" aria-labelledby="faq-title"><div className="container faq-grid"><div><p className="eyebrow">EN TOUTE TRANSPARENCE</p><h2 id="faq-title">Tout savoir<br /><span>avant de signer.</span></h2><p>Une question ?<br />On vous répond, simplement.</p><div className="faq-symbol" aria-hidden="true"><span /><span /></div></div><div className="faq-list">{FAQS.map((faq, index) => <div className={`faq-item ${faqOpen === index ? 'faq-open' : ''}`} key={faq.question}><h3><button type="button" aria-expanded={faqOpen === index} aria-controls={`faq-answer-${index}`} id={`faq-question-${index}`} onClick={() => setFaqOpen(faqOpen === index ? null : index)}>{faq.question}<span>{faqOpen === index ? <Minus size={18} /> : <Plus size={18} />}</span></button></h3><div id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} hidden={faqOpen !== index}><p>{faq.answer}</p>{index === 4 && <a className="text-link" href={PDF_URL} target="_blank" rel="noreferrer">Ouvrir le dossier PDF <ArrowUpRight size={15} /></a>}</div></div>)}</div></div></section>

        <section className="final-callout"><div className="container"><div><span>NOTRE LYCÉE. NOTRE VOIX. NOTRE ACTION.</span><h2>Ensemble, on avance.</h2></div><a className="button button-navy button-large" href="#signer">J’ajoute ma voix <ArrowUpRight size={21} /></a><svg viewBox="0 0 180 120" aria-hidden="true"><path d="M90 0A90 90 0 0 1 180 90H90Z" fill="#0A2D5E" /><path d="M0 120A90 90 0 0 1 90 30V120Z" fill="#1E81CE" /></svg></div></section>
      </main>

      <footer className="site-footer"><div className="container"><div className="footer-top"><div><Brand light /><p>Une voix. Plusieurs forces.<br />Une même action.</p></div><div className="footer-column"><h3>LE MOUVEMENT</h3><a href="#mobilisation">La mobilisation</a><a href="#revendications">Nos revendications</a><a href={PDF_URL} target="_blank" rel="noreferrer">Le dossier complet <ArrowUpRight size={12} /></a></div><div className="footer-column"><h3>VOTRE SOUTIEN</h3><a href="#signer">Signer la pétition</a><button type="button" onClick={() => void share()}>Partager la pétition</button><a href="#questions">Questions fréquentes</a></div><div className="footer-column"><h3>EN CONFIANCE</h3><button type="button" onClick={() => setModal('privacy')}>Confidentialité</button><button type="button" onClick={() => setModal('withdraw')}>Retirer ma signature</button>{data?.contactEmail && <a href={`mailto:${data.contactEmail}`}>Contacter le collectif <ArrowUpRight size={12} /></a>}<span className="footer-location"><MapPin size={13} /> Sainte-Anne, Guadeloupe</span></div></div><div className="footer-bottom"><span>© 2026 Leborgne en Action · Mobilisation 2026–2027</span><span>Une mobilisation calme et digne, sans violence ni dégradation.</span></div></div><ColorStripe /></footer>

      {showMobileSign && !signed && <div className="mobile-sign-bar"><div><strong>{data ? formatNumber(data.count) : '—'}</strong><span>{data?.count === 1 ? 'voix réunie' : 'voix réunies'}</span></div><a className="button button-yellow" href="#signer">Je signe la pétition <ArrowUpRight size={19} /></a></div>}
      {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Fermer la notification"><X size={17} /></button></div>}
      {modal && typeof modal !== 'string' && <Dialog title={modal.title} eyebrow={`REVENDICATION ${modal.number} / 07`} onClose={() => setModal(null)}><p className="modal-intro">{modal.description}</p><div className="priority-observation"><h3>Le constat</h3><p>{modal.observation}</p></div><h3 className="demands-heading">Ce que nous demandons</h3><ul className="demands-list">{modal.demands.map((demand) => <li key={demand}><span><Check size={14} /></span>{demand}</li>)}</ul>{modal.note && <p className="modal-note">{modal.note}</p>}<div className="modal-actions"><a className="button button-outline" href={`${PDF_URL}#page=${modal.page}`} target="_blank" rel="noreferrer"><FileText size={16} /> Lire le dossier · page {modal.page} <ArrowUpRight size={16} /></a><a className="button button-yellow" href="#signer" onClick={() => setModal(null)}>Je soutiens ces demandes <ArrowRight size={17} /></a></div><p className="modal-footnote">Constats issus des documents transmis. Les demandes nouvelles ou précisées sont soumises à validation collective.</p></Dialog>}
      {modal === 'privacy' && <Dialog title="Votre soutien. Votre vie privée." eyebrow="EN TOUTE TRANSPARENCE" onClose={() => setModal(null)}><PrivacyContent contactEmail={data?.contactEmail ?? null} onWithdraw={() => setModal('withdraw')} /></Dialog>}
      {modal === 'withdraw' && <Dialog title="Retirer ma signature." eyebrow="VOUS GARDEZ LE CHOIX" onClose={() => setModal(null)}><WithdrawForm onWithdraw={onWithdraw} /></Dialog>}
    </>
  )
}