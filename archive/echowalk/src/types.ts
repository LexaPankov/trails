export type Theme = 'antiquity' | 'medieval' | 'renaissance' | 'baroque' | 'modern' | 'hidden';

export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'antiquity', label: 'Antiquity', hint: 'Roman Mediolanum' },
  { id: 'medieval', label: 'Medieval', hint: 'Communes & Visconti' },
  { id: 'renaissance', label: 'Renaissance', hint: 'Sforza & Leonardo' },
  { id: 'baroque', label: 'Baroque', hint: '1600s–1700s' },
  { id: 'modern', label: 'Modern history', hint: '1770s to today' },
  { id: 'hidden', label: 'Hidden gems', hint: 'Places people walk past' },
];

export type RouteMode = 'highlights' | 'maximum' | 'climbs';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  period: string;
  themes: Theme[];
  significance: number; // 1..5
  hidden: boolean;
  summary: string;
  then: string;
  now: string;
  more: string;
  wikiQuery?: string;
  wikiUrl?: string;
  image?: string;
  audio?: string;
}

export interface CityInfo {
  id: string;
  name: string;
  center: [number, number];
  elevationData: boolean;
  elevationNote?: string;
  demoViewpoint: { name: string; lat: number; lon: number; heading: number };
}

export interface Dataset {
  schemaVersion: number;
  city: CityInfo;
  source: { generatedBy: string; note?: string; verified?: boolean };
  places: Place[];
}

export interface PlanRequest {
  startId: string;
  endId: string;
  minutes: number;
  themes: Theme[];
  mode: RouteMode;
}

export interface PlannedRoute {
  start: Place;
  end: Place;
  stops: Place[]; // ordered, excluding start/end
  distanceM: number;
  walkMin: number;
  dwellMin: number;
  totalMin: number;
  budgetMin: number;
  geometry: [number, number][]; // lat, lon
  routing: 'pedestrian' | 'estimated';
  notes: string[];
}
