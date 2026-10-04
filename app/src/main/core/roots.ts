// Kořeny knihovny: složka Songs (cesty bez předpony, jako vždy) + volitelné
// další složky (archiv chartů na jiném disku apod., issue #8). Cesty uvnitř
// dalších složek mají předponu `::<id>` — např. `::a1b2c3d4/Rock/Artist - Song`.
// Všechny operace knihovny převádějí cesty TADY, takže kontrola „cesta nesmí
// utéct ven" platí pro každý kořen stejně.

import { createHash } from 'crypto'
import { basename, relative, resolve, sep } from 'path'
import { getConfig } from './config'
import { isLinux } from './platform'

export const EXT_PREFIX = '::'

export interface ExtraFolder {
  id: string
  path: string
  name: string
}

/** Porovnání cest: Windows a macOS (výchozí APFS) velikost písmen nerozlišují,
 *  Linux ano — tam jsou `/data/Charts` a `/data/charts` dvě různé složky. */
export function foldPath(p: string): string {
  return isLinux ? p : p.toLowerCase()
}

/** Stabilní id podle cesty (nemění se při přidání/odebrání jiných složek). */
export function folderId(path: string): string {
  return createHash('sha1').update(foldPath(resolve(path))).digest('hex').slice(0, 8)
}

export function extraFolders(): ExtraFolder[] {
  return (getConfig().extraFolders ?? []).map((p) => ({ id: folderId(p), path: resolve(p), name: basename(resolve(p)) || p }))
}

export function songsRoot(): string {
  return resolve(getConfig().songsDir)
}

function inside(abs: string, base: string): boolean {
  return abs === base || abs.startsWith(base.endsWith(sep) ? base : base + sep)
}

/**
 * Relativní cesta (z rendereru) → kořen + absolutní cesta. Vyhodí, když cesta
 * míří mimo svůj kořen nebo na neznámou (mezitím odebranou) složku.
 */
export function resolveRel(rel: string): { base: string; abs: string; extra: ExtraFolder | null } {
  let base = songsRoot()
  let rest = rel || ''
  let extra: ExtraFolder | null = null
  if (rest.startsWith(EXT_PREFIX)) {
    const slash = rest.search(/[\\/]/)
    const id = (slash < 0 ? rest : rest.slice(0, slash)).slice(EXT_PREFIX.length)
    extra = extraFolders().find((f) => f.id === id) ?? null
    if (!extra) throw new Error('This folder is no longer in your list')
    base = extra.path
    rest = slash < 0 ? '' : rest.slice(slash + 1)
  }
  const abs = resolve(base, rest || '.')
  if (!inside(abs, base)) throw new Error('Path is outside the library')
  return { base, abs, extra }
}

/** Absolutní cesta → relativní cesta pro renderer (s předponou u dalších složek). */
export function toRel(abs: string): string {
  const a = resolve(abs)
  const songs = songsRoot()
  if (inside(a, songs)) return relative(songs, a).split(sep).join('/')
  for (const f of extraFolders()) {
    if (inside(a, f.path)) {
      const r = relative(f.path, a).split(sep).join('/')
      return r ? `${EXT_PREFIX}${f.id}/${r}` : `${EXT_PREFIX}${f.id}`
    }
  }
  throw new Error('Path is outside the library')
}

/** Je to kořen některé knihovny (Songs nebo další složka)? Ty se nesmí mazat/přesouvat. */
export function isRootAbs(abs: string): boolean {
  const a = resolve(abs)
  return a === songsRoot() || extraFolders().some((f) => f.path === a)
}

/** Leží cesta v některém kořeni? (přehrávač smí číst jen soubory knihoven) */
export function isInsideAnyRoot(abs: string): boolean {
  const a = resolve(abs)
  return inside(a, songsRoot()) || extraFolders().some((f) => inside(a, f.path))
}
