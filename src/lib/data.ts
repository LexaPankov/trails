import placesFile from '../../data/rome/places.json'
import imagesFile from '../../data/rome/landmark_images.json'
import placeImagesFile from '../../data/rome/place_images.json'
import type { Place, PlaceImage } from './types'

interface LandmarkImage extends PlaceImage { gld_id: string; split: 'reference' | 'test'; title?: string }
interface ImagesManifest {
  source: string
  source_url: string
  landmarks: Record<string, LandmarkImage[]>
  unknown_negatives: (LandmarkImage & { gld_category?: string })[]
}

export const PLACES: Place[] = (placesFile as { places: Place[] }).places
export const PLACE_BY_ID: Record<string, Place> = Object.fromEntries(PLACES.map((p) => [p.id, p]))
export const DATASET_VERSION: string = (placesFile as { version: string }).version
export const IMAGES = imagesFile as unknown as ImagesManifest
/** Wikipedia lead images (Wikimedia Commons, CC/PD only) fetched by scripts/fetch_open_data.py */
export const LEAD_IMAGES = placeImagesFile as unknown as Record<string, PlaceImage & { file_page?: string }>

/** Representative photo for a place (first reference image), or null when none is bundled. */
export function placeImage(id: string): PlaceImage | null {
  const imgs = IMAGES.landmarks[id]
  if (imgs && imgs.length) return imgs.find((i) => i.split === 'reference') ?? imgs[0]
  const lead = LEAD_IMAGES[id]
  return lead ? { ...lead, commons_page: lead.file_page ?? lead.commons_page } : null
}

export function placeImages(id: string): LandmarkImage[] {
  return IMAGES.landmarks[id] ?? []
}

export function getPlace(id: string | undefined | null): Place | undefined {
  return id ? PLACE_BY_ID[id] : undefined
}

export const PERIOD_LABEL: Record<string, string> = {
  ancient: 'Ancient Rome', medieval: 'Medieval', renaissance: 'Renaissance', baroque: 'Baroque', modern: 'Modern',
}
export const THEME_LABEL: Record<string, string> = {
  archaeology: 'Archaeology', architecture: 'Architecture', art: 'Art', religion: 'Religious heritage', civic: 'Civic life',
}
export const KIND_LABEL: Record<string, string> = { major: 'Landmark', notable: 'Notable', hidden_gem: 'Hidden gem' }
