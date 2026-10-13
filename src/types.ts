export type Role = '' | 'eleve' | 'personnel' | 'parent' | 'ancien' | 'soutien'

export interface Supporter {
  firstName: string
  lastInitial: string
  role: Role
  createdAt: string
}

export interface PetitionData {
  count: number
  goal: number
  publicCount: number
  supporters: Supporter[]
  contactEmail: string | null
  turnstileSiteKey?: string | null
}

export interface SignatureInput {
  firstName: string
  lastName: string
  email: string
  role: Role
  message: string
  consent: boolean
  isPublic: boolean
  website: string
  turnstileToken?: string
}

export interface SignatureResult {
  count: number
  goal: number
  firstName: string
  withdrawalCode: string
}

export interface Priority {
  id: string
  number: string
  title: string
  description: string
  color: 'blue' | 'navy' | 'green'
  icon: 'meals' | 'heat' | 'cafe' | 'computer' | 'hygiene' | 'sport' | 'gate'
  page: number
  observation: string
  demands: string[]
  note?: string
}
