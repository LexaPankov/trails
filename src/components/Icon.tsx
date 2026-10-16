// Small inline line-icon set (stroke icons, no emoji).
const P: Record<string, string> = {
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a4 4 0 0 1 4-4h2M18 9v6a4 4 0 0 1-4 4h-2',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  walk: 'M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-3 17 2-6 3 3v3m-5-12 3-1 2 3 3 1M10 9l-2 5',
  up: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
  down: 'M17 13V4h3v9h-3Zm0 0-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17',
  sound: 'M4 9v6h4l5 4V5L8 9H4Zm12-1a5 5 0 0 1 0 8m2.5-10.5a8.5 8.5 0 0 1 0 13',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  skip: 'M5 5l8 7-8 7V5Zm12 0v14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9v.5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  play: 'M7 5v14l11-7L7 5Z',
  pause: 'M8 5v14M16 5v14',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-3a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v3m0 14v3M2 12h3m14 0h3',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 20h16',
  image: 'M4 5h16v14H4V5Zm0 11 5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 0-.1',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  external: 'M14 4h6v6m0-6-9 9M18 14v6H4V6h6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  layers: 'M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
}

export function Icon({ name, size = 18, title }: { name: keyof typeof P | string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={P[name] ?? P.info} />
    </svg>
  )
}
