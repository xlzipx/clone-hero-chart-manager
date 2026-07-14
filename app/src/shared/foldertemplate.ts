/**
 * Šablona názvu/umístění složky chartu (feature request #1, inspirováno Bridge).
 *
 * Jedno pole popisuje OBOJÍ — kam chart uložit i jak se bude složka jmenovat:
 *
 *   {genre}/{artist}/{artist} - {title}
 *   └────── podsložky ──────┘ └── název složky ──┘
 *
 * Všechno před posledním `/` = podsložky uvnitř Songs, poslední segment = název
 * složky chartu. V Clone Hero je název složky zároveň jejím místem v knihovně,
 * proto je to jedna šablona a ne dvě nastavení.
 *
 * BEZ node závislostí — modul sdílí main (skutečná instalace) i renderer (živý
 * náhled v Nastavení), takže náhled nikdy nemůže lhát oproti realitě.
 */

/** Výchozí šablona = PŘESNĚ formát, který appka používala natvrdo do 0.9.6. */
export const DEFAULT_FOLDER_TEMPLATE = '{artist} - {title}'

/** Podmnožina `SongResult` potřebná pro šablonu (aby šel náhled krmit i literálem). */
export interface FolderTagSource {
  artist: string
  title: string
  album: string
  genre: string
  year: number | null
  charter: string | null
}

/** Tagy nabízené v Nastavení (pořadí = pořadí chipů v UI). */
export const FOLDER_TAGS = ['artist', 'title', 'charter', 'album', 'genre', 'year'] as const

export interface RenderedFolder {
  /** Podsložky uvnitř Songs (už sanitizované, bez prázdných a bez `.`/`..`). */
  dirs: string[]
  /** Název složky chartu (vždy neprázdný). */
  name: string
}

function tagValue(song: FolderTagSource, tag: string): string {
  switch (tag.toLowerCase()) {
    case 'artist':
      return song.artist ?? ''
    // `{name}` = alias pro `{title}` — takhle tomu říká Bridge, ať lidem sedí
    // šablona zkopírovaná odtamtud.
    case 'title':
    case 'name':
      return song.title ?? ''
    case 'charter':
      return song.charter ?? ''
    case 'album':
      return song.album ?? ''
    case 'genre':
      return song.genre ?? ''
    case 'year':
      return song.year != null ? String(song.year) : ''
    // Neznámý tag → prázdno (v náhledu je to hned vidět, takže překlep nezmizí tiše).
    default:
      return ''
  }
}

/**
 * Očistí JEDEN segment cesty. Shodná pravidla jako `sanitize()` v library.ts,
 * ale prázdný vrací prázdný (ne 'Unknown') — prázdné segmenty se musí dát zahodit.
 *
 * BEZPEČNOST: zahazuje i `/` a `\`, takže hodnota tagu (např. interpret
 * „AC/DC") NIKDY nevyrobí novou úroveň složky. Strukturu určuje jen `/`
 * v ŠABLONĚ, nikdy data.
 */
export function cleanSegment(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function substitute(seg: string, song: FolderTagSource): string {
  return seg.replace(/\{(\w+)\}/g, (_m, tag: string) => tagValue(song, tag))
}

/**
 * Šablona + metadata písně → podsložky a název složky.
 *
 * - Podsložka, která se vyrenderuje prázdná (chybí `{genre}`), se ZAHODÍ — jinak
 *   by knihovnu zaneřádily složky „Unknown".
 * - Název složky prázdný nikdy nebude: spadne zpět na `{artist} - {title}`, pak
 *   na 'Unknown'. Chart tak vždycky skončí v pojmenované složce.
 */
export function renderFolderTemplate(
  song: FolderTagSource,
  template: string | undefined | null
): RenderedFolder {
  const raw = (template ?? '').trim() || DEFAULT_FOLDER_TEMPLATE
  const parts = raw.split(/[\\/]/).filter((p) => p.trim() !== '')
  const lastRaw = parts.pop() ?? ''

  const dirs = parts
    .map((p) => cleanSegment(substitute(p, song)))
    .filter((p) => p !== '' && p !== '.' && p !== '..')

  let name = cleanSegment(substitute(lastRaw, song))
  if (name === '' || name === '.' || name === '..') {
    // Fallback na „Artist - Title", ale prázdné části vypustíme — jinak by
    // z chybějícího titulu vypadlo „Metallica -" s pahýlem pomlčky a z úplně
    // prázdných metadat složka pojmenovaná „-".
    name = [cleanSegment(song.artist ?? ''), cleanSegment(song.title ?? '')]
      .filter(Boolean)
      .join(' - ')
  }
  if (name === '' || name === '.' || name === '..') name = 'Unknown'

  return { dirs, name }
}

/** Náhled celé relativní cesty pro UI: „Rock\Metallica\Metallica - One". */
export function previewFolderPath(song: FolderTagSource, template: string): string {
  const { dirs, name } = renderFolderTemplate(song, template)
  return [...dirs, name].join('\\')
}
