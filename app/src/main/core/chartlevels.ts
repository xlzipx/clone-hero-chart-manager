import { app } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { notesStat } from './playlists'

/**
 * Které obtížnosti chart reálně obsahuje (Easy / Medium / Hard / Expert).
 *
 * song.ini to neříká (diff_* je jen „tier" 0–6), takže se čte přímo soubor
 * s notami. Výsledek je podmnožina písmen „emhx" v tomto pořadí — za celou
 * píseň, tj. úroveň se počítá, když ji má aspoň jeden nástroj (stejná
 * sémantika jako odznaky ve vyhledávání). Prázdný řetězec = žádné noty
 * nástrojů (třeba jen vokály).
 */

const ORDER = ['e', 'm', 'h', 'x'] as const
type Level = (typeof ORDER)[number]

const CHART_LEVEL: Record<string, Level> = { easy: 'e', medium: 'm', hard: 'h', expert: 'x' }

/** notes.chart: sekce [EasySingle], [ExpertDrums]… s aspoň jednou notou. */
export function chartLevels(text: string): string {
  const found = new Set<Level>()
  const re = /\[(Easy|Medium|Hard|Expert)[A-Za-z0-9]*\]\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (/=\s*N\s+\d/.test(m[2])) found.add(CHART_LEVEL[m[1].toLowerCase()])
  }
  return ORDER.filter((l) => found.has(l)).join('')
}

// Rozsahy MIDI not podle obtížnosti (Rock Band / Clone Hero). U 5-fret a bicích
// leží noty 40–59 mimo hru (animace ruky), proto Easy začíná až na 60.
// Expert od 95 kvůli dvojitému kopáku (Expert+). 6-fret (GHL) má open notu o
// dvě níž (58 / 70 / 82 / 94).
const RANGES: Record<Level, [number, number]> = { e: [60, 66], m: [72, 78], h: [84, 90], x: [95, 102] }
const RANGES_GHL: Record<Level, [number, number]> = { e: [58, 66], m: [70, 78], h: [82, 90], x: [94, 102] }

function readVar(b: Buffer, i: number): [number, number] {
  let v = 0
  for (let n = 0; n < 4 && i < b.length; n++) {
    const c = b[i++]
    v = (v << 7) | (c & 0x7f)
    if (!(c & 0x80)) break
  }
  return [v, i]
}

/** Hrací stopa nástroje (ne vokály, harmonie, pro keys/real nástroje, animace). */
function isPlayTrack(name: string): boolean {
  const up = name.toUpperCase()
  return up.startsWith('PART ') && !/VOCAL|HARM|REAL_|ANIM/.test(up)
}

/** notes.mid: které rozsahy not mají hrací stopy nástrojů. */
export function midLevels(b: Buffer): string {
  if (b.length < 14 || b.toString('latin1', 0, 4) !== 'MThd') return ''
  const found = new Set<Level>()
  // Stopy hledáme podle značky „MTrk", ne podle délky v hlavičce stopy: některé
  // charty ji mají špatně (stopa je delší) a čtení podle ní by zbytek souboru
  // přeskočilo. Stopa končí nejpozději tam, kde začíná další.
  let p = 8 + b.readUInt32BE(4)
  for (;;) {
    const at = b.indexOf('MTrk', p, 'latin1')
    if (at < 0) break
    const next = b.indexOf('MTrk', at + 8, 'latin1')
    const end = next < 0 ? b.length : next
    let i = at + 8
    p = end
    // Running status = poslední kanálový status. Meta / sysex události ho podle
    // normy ruší, jenže soubory z Rock Bandu / Magmy na něj za textovými
    // událostmi dál spoléhají (Clone Hero i běžné knihovny je čtou takhle).
    let running = 0
    let name = ''
    const notes = new Uint8Array(128)
    while (i < end) {
      ;[, i] = readVar(b, i) // delta time
      if (i >= end) break
      let status: number
      if (b[i] & 0x80) status = b[i++]
      else if (running) status = running
      else break // poškozená stopa
      if (status === 0xff) {
        const type = b[i]
        const [len, j] = readVar(b, i + 1)
        if (type === 0x03 && !name) name = b.toString('latin1', j, Math.min(j + len, end))
        if (type === 0x2f) break // konec stopy
        i = j + len
      } else if (status === 0xf0 || status === 0xf7) {
        const [len, j] = readVar(b, i)
        i = j + len
      } else {
        running = status
        const kind = status & 0xf0
        if (kind === 0x90) {
          if (b[i + 1] > 0) notes[b[i] & 0x7f] = 1
          i += 2
        } else if (kind === 0xc0 || kind === 0xd0) i += 1
        else i += 2
      }
    }
    if (!isPlayTrack(name)) continue
    const ranges = name.toUpperCase().includes('GHL') ? RANGES_GHL : RANGES
    for (const l of ORDER) {
      if (found.has(l)) continue
      const [a, z] = ranges[l]
      for (let n = a; n <= z; n++) {
        if (notes[n]) {
          found.add(l)
          break
        }
      }
    }
  }
  return ORDER.filter((l) => found.has(l)).join('')
}

// ── Perzistentní cache (jako hash-index: klíč = soubor s notami, platí dokud
// se nezmění mtime + velikost) ─────────────────────────────────────────────
interface LevelsEntry {
  mtimeMs: number
  size: number
  levels: string
}
let cache: Map<string, LevelsEntry> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function cachePath(): string {
  // Verze v názvu: po opravě čtení not se staré (chybné) výsledky zahodí.
  return join(app.getPath('userData'), 'levels-index-v2.json')
}

async function loadCache(): Promise<Map<string, LevelsEntry>> {
  if (cache) return cache
  try {
    cache = new Map(Object.entries(JSON.parse(await fsp.readFile(cachePath(), 'utf-8'))))
  } catch {
    cache = new Map()
  }
  return cache
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!cache) return
    const tmp = `${cachePath()}.tmp`
    void fsp
      .writeFile(tmp, JSON.stringify(Object.fromEntries(cache)))
      .then(() => fsp.rename(tmp, cachePath()))
      .catch(() => undefined) // selhání = jen přepočet příště
  }, 2000)
  saveTimer.unref?.()
}

/** Obtížnosti písně (složky) z cache, nebo přečtené ze souboru s notami.
 *  null = složka nemá notes.chart / notes.mid, nebo nejde přečíst. */
export async function songLevelsCached(folderAbs: string): Promise<string | null> {
  const st = await notesStat(folderAbs)
  if (!st) return null
  const c = await loadCache()
  const hit = c.get(st.path)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.levels
  let levels: string
  try {
    const buf = await fsp.readFile(st.path)
    levels = st.path.toLowerCase().endsWith('.chart') ? chartLevels(buf.toString('utf-8')) : midLevels(buf)
  } catch {
    return null
  }
  c.set(st.path, { mtimeMs: st.mtimeMs, size: st.size, levels })
  scheduleSave()
  return levels
}
