import { ArrowDown, ArrowUpRight, UsersRound } from 'lucide-react'

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <a href="#accueil" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Leborgne en Action — accueil">
      <img src="/assets/logo.png" alt="" width="44" height="50" />
      <span>LEBORGNE<br />EN ACTION<span className="brand-caption">UNE VOIX. PLUSIEURS FORCES.</span></span>
    </a>
  )
}

export function BrandShapes({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 220" fill="none" aria-hidden="true">
      <path d="M96 0C65 0 43 26 43 55C43 75 36 88 25 99C55 99 77 77 96 55V0Z" fill="#1E81CE" />
      <path d="M96 0C124 0 147 24 147 53C147 69 132 84 118 98L96 116V0Z" fill="#0A2D5E" />
      <path d="M147 0C177 0 198 26 198 57C198 91 177 116 147 116H96C126 116 147 96 147 76V0Z" fill="#FFC72C" />
      <path d="M0 116H96L45 168C20 168 0 144 0 116Z" fill="#0A2D5E" />
      <path d="M96 116H147C97 116 68 153 50 178L25 220C25 181 48 149 96 116Z" fill="#FFC72C" />
      <path d="M96 168C96 139 118 116 147 116C175 116 198 139 198 168H96Z" fill="#009444" />
      <path d="M96 168H198C198 196 175 220 147 220C118 220 96 196 96 168Z" fill="#1E81CE" />
    </svg>
  )
}

export function Starburst() {
  return (
    <a href="#signer" className="starburst" aria-label="Aller à la signature de la pétition">
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <path id="starburst-circle" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" fill="none" />
        </defs>
        <circle cx="60" cy="60" r="58" fill="#FFC72C" stroke="#0A2D5E" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="30" fill="none" stroke="#0A2D5E" strokeWidth="1.5" strokeDasharray="4 4" />
        <text><textPath href="#starburst-circle" textLength="274" lengthAdjust="spacingAndGlyphs">JE SIGNE ★ JE SIGNE ★ JE SIGNE ★</textPath></text>
      </svg>
      <span aria-hidden="true"><ArrowDown size={26} strokeWidth={2.5} /></span>
    </a>
  )
}

export function CampaignPoster() {
  return (
    <div className="poster-wrap">
      <Starburst />
      <div className="campaign-poster" aria-label="Une voix. Plusieurs forces. Une même action. Lycée Yves Leborgne, Guadeloupe.">
        <div className="poster-topline"><span>LEBORGNE<br />EN ACTION</span><ArrowUpRight size={24} strokeWidth={1.5} /></div>
        <svg className="poster-art" viewBox="0 0 420 410" fill="none" aria-hidden="true">
          <path d="M230 -30C156 -30 96 30 96 103C96 154 79 183 52 212C126 212 180 162 230 112V-30Z" fill="#FFFFFF" />
          <path d="M260 -30C339 -30 400 29 400 108C400 190 339 249 260 249V-30Z" fill="#1E81CE" />
          <path d="M262 340C262 293 300 255 347 255C394 255 432 293 432 340H262Z" fill="#009444" />
          <path d="M262 340H432C432 387 394 425 347 425C300 425 262 387 262 340Z" fill="#FFFFFF" />
        </svg>
        <div className="poster-copy">UNE VOIX.<br />PLUSIEURS<br />FORCES.<br /><span>UNE MÊME<br /><span>ACTION.</span></span></div>
        <div className="poster-bottomline"><span>SAINTE-ANNE · GUADELOUPE</span><span>2026—2027</span></div>
      </div>
      <div className="poster-label"><span className="poster-label-icon"><UsersRound size={22} strokeWidth={1.7} /></span><span><strong>Notre lycée, notre avenir.</strong><small>Ensemble, on fait bouger les lignes.</small></span><span className="label-dot" /></div>
    </div>
  )
}

export function ColorStripe() {
  return <div className="color-stripe" aria-hidden="true"><span /><span /><span /><span /><span /></div>
}
