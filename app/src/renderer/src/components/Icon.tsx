import type { CSSProperties } from 'react'
import bassPng from '../assets/instruments/bass.png'
import drumsPng from '../assets/instruments/drums.png'
import guitarPng from '../assets/instruments/guitar.png'
import keysPng from '../assets/instruments/keys.png'
import vocalsPng from '../assets/instruments/vocals.png'

const INSTRUMENT_PNGS: Partial<Record<string, string>> = {
  guitar: guitarPng,
  bass: bassPng,
  drums: drumsPng,
  keys: keysPng,
  vocals: vocalsPng
}

export type IconName =
  | 'guitar'
  | 'bass'
  | 'drums'
  | 'keys'
  | 'vocals'
  | 'search'
  | 'download'
  | 'settings'
  | 'gamepad'
  | 'minimize'
  | 'close'
  | 'info'
  | 'more'
  | 'caret'
  | 'chevronLeft'
  | 'chevronRight'
  | 'folder'
  | 'charter'
  | 'globe'
  | 'link'
  | 'copy'
  | 'external'
  | 'file'
  | 'folderPlus'
  | 'trash'
  | 'scissors'
  | 'paste'
  | 'refresh'
  | 'note'
  | 'check'
  | 'filter'
  | 'play'
  | 'pause'
  | 'previewOff'
  | 'dice'
  | 'lightbulb'
  | 'playlist'

// Obsah jednotlivých ikon (viewBox 0 0 24 24). Stroke dědí currentColor.
const PATHS: Record<IconName, JSX.Element> = {
  // trsátko (lead kytara) – plné
  guitar: (
    <path
      d="M12 2.5c4.2 0 7.5 3 7.5 7 0 5-5.2 10.5-7.5 12-2.3-1.5-7.5-7-7.5-12 0-4 3.3-7 7.5-7Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // basa – beamed noty
  bass: (
    <>
      <path d="M9 17V6l10-2v9" />
      <circle cx="6.5" cy="17" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="13" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  // bicí
  drums: (
    <>
      <ellipse cx="12" cy="9" rx="8" ry="3" />
      <path d="M4 9v5c0 1.6 3.6 3 8 3s8-1.4 8-3V9" />
      <path d="M14.5 4.5l5-2M16.5 6.5l4.5-1.5" />
    </>
  ),
  // klávesy
  keys: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v14M13 5v14M18 5v14" />
      <path d="M6.6 5v6M11.4 5v6M16.2 5v6" strokeWidth="2.6" />
    </>
  ),
  // mikrofon
  vocals: (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4M8.5 21h7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  gamepad: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <path d="M6.5 11v2M5.5 12h2" />
      <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  minimize: <line x1="6" y1="15" x2="18" y2="15" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  caret: <polyline points="6 9 12 15 18 9" />,
  check: <polyline points="20 6 9 17 4 12" />,
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
  chevronLeft: <polyline points="15 6 9 12 15 18" />,
  chevronRight: <polyline points="9 6 15 12 9 18" />,
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  charter: (
    <>
      <path d="M14 4l6 6" />
      <path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M10.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 8l12 8M8 16L20 8" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </>
  ),
  note: (
    <>
      <path d="M9 18V6l9-2v10" />
      <circle cx="6.5" cy="18" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  play: <polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // „Bez ukázky" – přeškrtnutý kruh (univerzální „není k dispozici").
  previewOff: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </>
  ),
  // hrací kostka (5) – „Surprise me" / náhodný výběr
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  // žárovka – univerzální symbol pro „tip"
  lightbulb: (
    <>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 6 8c0 1.3.5 2.5 1.5 3.5.8.8 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 21h4" />
    </>
  ),
  // playlist – řádky seznamu + přehrávací trojúhelník (import playlistu)
  playlist: (
    <>
      <path d="M4 7h13M4 12h13M4 17h6" />
      <polygon points="14 15 20 18 14 21" fill="currentColor" stroke="none" />
    </>
  )
}

interface Props {
  name: IconName
  size?: number
  color?: string
  className?: string
  style?: CSSProperties
  /** Nativní tooltip. Ikona je jinak dekorativní (aria-hidden) — nastav jen tam,
   *  kde je ikona JEDINÝM nositelem informace (např. nástroje v importu playlistu). */
  title?: string
}

export function Icon({ name, size = 16, color, className, style, title }: Props): JSX.Element {
  // Pro 5 nástrojů (guitar/bass/drums/keys/vocals) používáme dodané PNG
  // jako CSS mask — díky tomu si zachovají per-nástroj barvu přes currentColor.
  const pngSrc = INSTRUMENT_PNGS[name]
  if (pngSrc) {
    return (
      <span
        className={className}
        title={title}
        // S tooltipem už ikona nese informaci → nesmí být skrytá odečítačům.
        aria-hidden={title ? undefined : 'true'}
        role={title ? 'img' : undefined}
        aria-label={title}
        style={{
          color,
          width: size,
          height: size,
          display: 'inline-block',
          flexShrink: 0,
          background: 'currentColor',
          WebkitMask: `url(${pngSrc}) center / contain no-repeat`,
          mask: `url(${pngSrc}) center / contain no-repeat`,
          ...style
        }}
      />
    )
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, flexShrink: 0, display: 'block', overflow: 'visible', ...style }}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {/* <title> = nativní tooltip u SVG (atribut `title` na <svg> nefunguje). */}
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  )
}
