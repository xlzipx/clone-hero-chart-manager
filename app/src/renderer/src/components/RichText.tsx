import { useMemo } from 'react'

// Vykreslí Clone Hero / Unity rich-text tagy (<color=…>, <b>, <i>) barevně,
// stejně jako je renderuje hra. Charteři si je dávají do song.ini, aby jejich
// jméno ve hře svítilo — my je dřív ukazovali syrově, teď je ctíme.
//
// Bezpečnost: ŽÁDNÉ dangerouslySetInnerHTML — vlastní mini-parser skládá React
// <span>y a barvy pouští jen přes whitelist (hex / známá jména). Neznámé tagy
// (třeba matematické "A < B") nechává jako obyčejný text, přesně jako Unity.

interface Seg {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
}

/** Povolená jména barev (Unity rich text named colors). */
const NAMED_COLORS = new Set([
  'aqua', 'black', 'blue', 'brown', 'cyan', 'darkblue', 'fuchsia', 'green',
  'grey', 'gray', 'lightblue', 'lime', 'magenta', 'maroon', 'navy', 'olive',
  'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow'
])

/** Zvaliduje hodnotu z <color=…> → CSS barva, nebo undefined (ignoruj). */
function sanitizeColor(raw: string): string | undefined {
  const v = raw.trim().replace(/^["']|["']$/g, '')
  if (/^#?[0-9a-f]{3}$/i.test(v) || /^#?[0-9a-f]{4}$/i.test(v) || /^#?[0-9a-f]{6}$/i.test(v) || /^#?[0-9a-f]{8}$/i.test(v)) {
    return v.startsWith('#') ? v : `#${v}`
  }
  const lower = v.toLowerCase()
  return NAMED_COLORS.has(lower) ? lower : undefined
}

/** Tagy, které umíme (color s hodnotou; b/i stylují; zbytek jen tiše zahodit). */
const TAG_RE = /<(\/?)(color|b|i|u|s|size|material|quad|sprite|alpha|mark|noparse)(?:=([^>]*))?>/gi

export function parseRichText(input: string): Seg[] {
  const segs: Seg[] = []
  const colorStack: (string | undefined)[] = []
  let bold = 0
  let italic = 0
  let last = 0

  const pushText = (text: string): void => {
    if (!text) return
    segs.push({
      text,
      color: colorStack.length ? colorStack[colorStack.length - 1] : undefined,
      bold: bold > 0,
      italic: italic > 0
    })
  }

  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(input); m; m = TAG_RE.exec(input)) {
    pushText(input.slice(last, m.index))
    last = m.index + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'color') {
      if (closing) colorStack.pop()
      else colorStack.push(sanitizeColor(m[3] ?? ''))
    } else if (tag === 'b') {
      bold = Math.max(0, bold + (closing ? -1 : 1))
    } else if (tag === 'i') {
      italic = Math.max(0, italic + (closing ? -1 : 1))
    }
    // Ostatní známé tagy (size, u, s, …) jen zahodíme — obsah zůstává.
  }
  pushText(input.slice(last))
  return segs
}

/** Text s CH tagy vykreslený barevně; bez tagů vrací prostý text (rychlá cesta). */
export function RichText({ text }: { text: string }): JSX.Element {
  const segs = useMemo(() => (text.includes('<') ? parseRichText(text) : null), [text])
  if (!segs) return <>{text}</>
  return (
    <>
      {segs.map((s, i) =>
        s.color || s.bold || s.italic ? (
          <span
            key={i}
            style={{
              color: s.color,
              fontWeight: s.bold ? 700 : undefined,
              fontStyle: s.italic ? 'italic' : undefined
            }}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}
