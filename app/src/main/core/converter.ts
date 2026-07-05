// Konverze CON/.rb3con → Clone Hero formát přes Onyx Music Game Toolkit (CLI).
//
// Onyx (https://github.com/mtolly/onyx) je purpose-built CLI konvertor.
// Postup:
//   1) onyx import <CON> --to <projDir>      → vytvoří projekt se song.yml
//   2) do song.yml se přidá Phase Shift target (`ps`), pokud chybí
//   3) onyx build <projDir>/song.yml --target ps --to <outDir>
//      → výstup je složka se song.ini + notes.mid + album.png + audio (.ogg),
//        kterou Clone Hero přečte přímo.

import { existsSync, mkdtempSync, readFileSync, rmSync, appendFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getConfig } from './config'
import { run } from './proc'

export interface ConvertProgress {
  progress: number
  message?: string
}

export function converterAvailable(): boolean {
  return existsSync(getConfig().onyxPath)
}

/**
 * Zajistí, že song.yml má Phase Shift target v sekci `targets:`.
 * CON import sekci `targets:` má, DTXMania import ji NEMÁ (končí `plans:`).
 * Naivní append `  ps:` by u DTX spadl pod `plans:` → build error. Proto:
 *   - když `targets:` chybí, přidáme ji jako nový top-level klíč,
 *   - když existuje, vložíme `ps` jako první cíl hned za ni (není-li už tam).
 */
function ensurePsTarget(songYml: string): void {
  const content = readFileSync(songYml, 'utf-8')
  const lines = content.split('\n')
  const ti = lines.findIndex((l) => /^targets:\s*$/.test(l))
  if (ti === -1) {
    const sep = content.endsWith('\n') ? '' : '\n'
    appendFileSync(songYml, `${sep}targets:\n  ps:\n    game: ps\n`, 'utf-8')
    return
  }
  // targets existuje — má už `ps` cíl? (jen mezi odsazenými potomky bloku)
  for (let i = ti + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break // další top-level klíč = konec bloku targets
    if (/^\s{2}ps:\s*$/.test(lines[i])) return
  }
  lines.splice(ti + 1, 0, '  ps:', '    game: ps')
  writeFileSync(songYml, lines.join('\n'), 'utf-8')
}

/**
 * Obecná Onyx konverze: import libovolného podporovaného vstupu (CON, DTXMania
 * set.def/.dtx, …) → build do Phase Shift/CH formátu. Výstup jde přímo do
 * `outDir` (album.png, notes.mid, song.ini, *.ogg).
 */
async function onyxConvert(
  inputPath: string,
  outDir: string,
  kind: 'CON' | 'DTX',
  onProgress?: (p: ConvertProgress) => void
): Promise<void> {
  const onyx = getConfig().onyxPath
  if (!existsSync(onyx)) {
    throw new Error(
      `Onyx (onyx.exe) not found (${onyx}). Download the Onyx CLI or set the path in Settings.`
    )
  }

  // Onyx import si cílový adresář vytváří sám → předáme NEexistující podsložku
  // uvnitř dočasného rodiče (mkdtemp jen ten rodič).
  const parentDir = mkdtempSync(join(tmpdir(), 'onyx-'))
  const projDir = join(parentDir, 'proj')
  try {
    // 1) Import
    onProgress?.({ progress: -1, message: kind === 'DTX' ? 'Importing DTX…' : 'Importing CON…' })
    const imp = await run(onyx, ['import', inputPath, '--to', projDir])
    if (imp.code !== 0) {
      throw new Error(`Onyx import failed (code ${imp.code}): ${imp.stderr || imp.stdout}`)
    }

    const songYml = join(projDir, 'song.yml')
    if (!existsSync(songYml)) {
      throw new Error('Onyx import did not create song.yml (possibly an unsupported file)')
    }

    // 2) Phase Shift target
    ensurePsTarget(songYml)

    // 3) Build → CH folder
    onProgress?.({ progress: -1, message: 'Generating chart and audio…' })
    const build = await run(
      onyx,
      ['build', songYml, '--target', 'ps', '--to', outDir],
      (line, stream) => {
        if (stream === 'stdout' && /writing audio|finished/i.test(line)) {
          onProgress?.({ progress: -1, message: line.trim().slice(0, 80) })
        }
      }
    )
    if (build.code !== 0) {
      throw new Error(`Onyx build failed (code ${build.code}): ${build.stderr || build.stdout}`)
    }
  } finally {
    try {
      if (existsSync(parentDir)) rmSync(parentDir, { recursive: true, force: true })
    } catch {
      /* úklid best-effort */
    }
  }
}

/**
 * Zkonvertuje jeden CON soubor do CH formátu.
 */
export function convertCon(
  inputPath: string,
  outDir: string,
  onProgress?: (p: ConvertProgress) => void
): Promise<void> {
  return onyxConvert(inputPath, outDir, 'CON', onProgress)
}

/**
 * Zkonvertuje DTXMania song do CH formátu. `inputPath` je cesta k `set.def`
 * (importuje celou sadu, nejvyšší obtížnost jako Expert + autogen nižší), nebo
 * ke konkrétnímu `.dtx`/`.gda` souboru.
 */
export function convertDtx(
  inputPath: string,
  outDir: string,
  onProgress?: (p: ConvertProgress) => void
): Promise<void> {
  return onyxConvert(inputPath, outDir, 'DTX', onProgress)
}
