/** Obsažené obtížnosti chartu (písmena „emhx", viz main/core/chartlevels.ts). */
export type Level = 'e' | 'm' | 'h' | 'x'

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'e', label: 'Easy' },
  { id: 'm', label: 'Medium' },
  { id: 'h', label: 'Hard' },
  { id: 'x', label: 'Expert' }
]

/** Odznak obsažených obtížností: neutrální pilulka s žebříčkem Easy → Expert
 *  (rozsvícené dílky = obsažené úrovně, barvy zelená → červená) a popiskem
 *  slovy. Sdílený mezi vyhledáváním a My Library, ať znamená všude totéž. */
export function LevelsBadge({ levels }: { levels: string | null | undefined }): JSX.Element | null {
  if (!levels) return null
  const names = LEVELS.filter((l) => levels.includes(l.id)).map((l) => l.label)
  const text =
    levels === 'emhx' ? 'Easy to Expert' : levels === 'x' ? 'Expert only' : names.join(' + ')
  const title =
    levels === 'emhx'
      ? 'Charted on every difficulty: Easy, Medium, Hard and Expert'
      : levels === 'x'
        ? 'Charted on Expert only, no easier difficulties'
        : `Charted on ${names.join(', ')} only`
  return (
    // Barva = nejlehčí obsažená úroveň (od čeho jde chart hrát).
    <span className={`badge badge--levels badge--levels-${levels[0]}`} title={title}>
      <span className="lvlseg" aria-hidden="true">
        {LEVELS.map((l) => (
          <i key={l.id} className={levels.includes(l.id) ? `lvlseg--${l.id}` : undefined} />
        ))}
      </span>
      {text}
    </span>
  )
}

/** Splňuje chart filtr obtížností? Neznámé úrovně (null) při aktivním filtru
 *  vypadnou — nemá smysl je ukazovat jako shodu. */
export function levelsMatch(levels: string | null | undefined, wanted: Level[], expertOnly: boolean): boolean {
  if (!expertOnly && wanted.length === 0) return true
  if (levels == null) return false
  if (expertOnly) return levels === 'x'
  return wanted.every((l) => levels.includes(l))
}
