export type Period = 'ancient' | 'medieval' | 'renaissance' | 'baroque' | 'modern'
export type Theme = 'archaeology' | 'architecture' | 'art' | 'religion' | 'civic'
export type Interest =
  | 'ancient' | 'medieval' | 'renaissance' | 'baroque' | 'modern'
  | 'archaeology' | 'art_architecture' | 'hidden_gems'
export type PlaceKind = 'major' | 'notable' | 'hidden_gem'

export interface Source { title: string; url: string; verified?: boolean }

export interface PlaceImage {
  file: string
  author: string
  license: string
  license_url?: string | null
  commons_page: string
}

export interface Place {
  id: string
  name: string
  lat: number
  lon: number
  periods: Period[]
  themes: Theme[]
  significance: number
  kind: PlaceKind
  category: string
  built?: string
  summary: string
  then_now?: string
  history?: string
  visit_minutes: number
  related: string[]
  sources: Source[]
  vision?: { supported: boolean }
  wikidata?: string
  coord_source?: 'wikipedia' | 'wikidata' | 'curated'
  /** wikidata = imported automatically from Wikidata + the Wikipedia lead, not reviewed by hand */
  origin?: 'curated' | 'wikidata'
}

export type LatLon = { lat: number; lon: number }

export type RouteMode = 'fastest' | 'discovery' | 'history'

export interface Endpoint extends LatLon {
  label: string
  placeId?: string
}
