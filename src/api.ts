import type { PetitionData, SignatureInput, SignatureResult } from './types'

export class ApiError extends Error {
  fields: Record<string, string>
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message)
    this.fields = fields
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('La connexion au serveur est indisponible. Vérifiez votre connexion et réessayez. Aucune signature n’a été confirmée.')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(result?.error ?? 'Le serveur n’a pas pu traiter la demande. Réessayez dans quelques instants.', result?.fields)
  }
  if (!result) throw new ApiError('La réponse du serveur est invalide. Merci de réessayer.')
  return result as T
}

export const getPetition = (signal?: AbortSignal) => request<PetitionData>('/api/petition', { signal })
export const signPetition = (input: SignatureInput) => request<SignatureResult>('/api/signatures', {
  method: 'POST', body: JSON.stringify(input),
})
export const withdrawSignature = (withdrawalCode: string) => request<{ count: number; goal: number; withdrawn: boolean }>('/api/signatures/withdraw', {
  method: 'POST', body: JSON.stringify({ withdrawalCode }),
})

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const previous = document.activeElement as HTMLElement | null
  const input = document.createElement('textarea')
  input.value = text
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  previous?.focus()
  if (!copied) throw new Error('Clipboard unavailable')
}
