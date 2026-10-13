// Validation et conventions communes aux API Node et Cloudflare.
// Ce module n'utilise aucune API Node : il est exécutable dans un Worker.
export const CONSENT_VERSION = '2026-10-13-v1'
export const ROLES = ['', 'eleve', 'personnel', 'parent', 'ancien', 'soutien']

export const cleanText = (value) => typeof value === 'string' ? value.trim().normalize('NFC') : ''
export const validEmail = (email) => email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
export const validName = (name) => name.length >= 1 && name.length <= 80 && !/[<>\x00-\x1f\x7f]/.test(name)
export const csvCell = (value) => {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function validateSignature(body) {
  const firstName = cleanText(body.firstName)
  const lastName = cleanText(body.lastName)
  const email = cleanText(body.email).toLowerCase()
  const role = cleanText(body.role)
  const message = cleanText(body.message)
  const fields = {}
  if (!validName(firstName)) fields.firstName = 'Indiquez votre prénom (80 caractères maximum).'
  if (!validName(lastName)) fields.lastName = 'Indiquez votre nom (80 caractères maximum).'
  if (!validEmail(email)) fields.email = 'Indiquez une adresse e-mail valide.'
  if (!ROLES.includes(role)) fields.role = 'Choisissez un profil proposé dans la liste.'
  if (message.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message)) {
    fields.message = 'Votre message doit comporter au maximum 1 000 caractères.'
  }
  if (body.consent !== true) fields.consent = 'Votre accord est nécessaire pour enregistrer la signature.'
  return { firstName, lastName, email, role, message, fields }
}
