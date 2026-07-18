// Rozbalování archivů přes moderní 7-Zip (zip / 7z / RAR5 / tar / gz).

import { existsSync, rmSync } from 'fs'
import { basename, extname, join } from 'path'
import { getConfig } from './config'
import { ensureExecutable, sevenZipBinaryName } from './platform'
import { run } from './proc'

function sevenZipPath(): string {
  const bin = sevenZipBinaryName() // 7z.exe (Windows) / 7zz (macOS, Linux)
  const exe = join(getConfig().c3BinDir, bin)
  if (!existsSync(exe)) {
    throw new Error(`${bin} not found in ${getConfig().c3BinDir} (check the 7-Zip path in Settings)`)
  }
  ensureExecutable(exe)
  return exe
}

const ARCHIVE_EXT = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.001'])

export function isArchive(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  for (const ext of ARCHIVE_EXT) if (lower.endsWith(ext)) return true
  return false
}

// Kosmetické soubory. Když se poškodí (CRC) jen tyhle, chart je pořád hratelný,
// takže je při rozbalování zahodíme a pokračujeme. Naopak nóty (.chart/.mid),
// song.ini a audio jsou nezbytné — jejich poškození necháme selhat.
const COSMETIC_EXT = new Set([
  '.webm', '.mp4', '.avi', '.mkv', '.mov', '.m4v', // video (pozadí / background)
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp' // album art / pozadí / highway
])

/**
 * Vytáhne z 7z výstupu cesty souborů, které selhaly na CRC / data error.
 * Formát moderního 7-Zipu: `ERROR: CRC Failed : slozka/soubor.webm`. Vyžadujeme
 * dvojtečku před cestou, ať nechytneme věty typu „Data Error in encrypted file".
 */
function parseFailedFiles(output: string): string[] {
  const files = new Set<string>()
  for (const raw of output.split(/\r?\n/)) {
    const m = /(?:CRC Failed|Data Error)\s*:\s*(.+\S)\s*$/i.exec(raw)
    if (m) files.add(m[1].trim().replace(/\\/g, '/'))
  }
  return [...files]
}

/** Rozbalí archiv do cílové složky.
 *
 * 7z exit kódy:
 *   0 = OK
 *   1 = warning (extrahuje, ale s upozorněním – třeba i CRC u 1 souboru)
 *   2 = fatal error
 *   7 = bad command line
 *   8 = not enough memory
 *
 * Vrací názvy KOSMETICKÝCH souborů, které byly poškozené a přeskočené (prázdné
 * pole = vše v pořádku). Při poškození nezbytných souborů (nóty, song.ini,
 * audio) nebo strukturální chybě archivu vyhodí srozumitelnou chybu.
 */
export async function extract(archivePath: string, destDir: string): Promise<string[]> {
  const exe = sevenZipPath()
  // -p (prázdné heslo): u šifrovaného archivu 7z rovnou selže místo promptu.
  // -- : konec přepínačů, aby se archiv s názvem začínajícím „-" nepovažoval za switch.
  const res = await run(exe, ['x', '-y', '-p', `-o${destDir}`, '--', archivePath])
  if (res.code === 0) return []

  const out = res.stdout + '\n' + res.stderr
  const lower = out.toLowerCase()
  const headersOrPw = /headers error|wrong password/.test(lower)
  const perFileCrc = /crc failed|data error/.test(lower)
  const cantOpen = /can not open file as archive|is not archive/.test(lower)

  // Per-file CRC/data error, který NENÍ strukturální (headers) ani heslo: pokud
  // jsou poškozené jen kosmetické soubory (video / obrázky), 7z zbytek přesto
  // rozbalil → poškozené smažeme a pokračujeme, chart je hratelný i bez nich.
  if (perFileCrc && !headersOrPw) {
    const failed = parseFailedFiles(out)
    if (failed.length > 0 && failed.every((f) => COSMETIC_EXT.has(extname(f).toLowerCase()))) {
      const skipped: string[] = []
      for (const f of failed) {
        try {
          const abs = join(destDir, f)
          if (existsSync(abs)) rmSync(abs, { force: true })
        } catch {
          /* úklid best-effort */
        }
        skipped.push(basename(f))
      }
      return skipped
    }
  }

  if (perFileCrc || headersOrPw) {
    throw new Error(
      'Archive is corrupted (CRC errors during extraction). The original upload on the host is damaged. Try a different version of this song from the search results, or open the chart page in browser (⋮ menu) and download manually.'
    )
  }
  if (cantOpen) {
    throw new Error(
      'Downloaded file is not a valid archive. The link may have returned an HTML error page or a partial download. Try again, or use the ⋮ menu to open in browser.'
    )
  }
  // Generic fallback — zkrácený výstup, žádný flood cestami.
  const snippet = (res.stderr || res.stdout).split('\n').slice(0, 3).join(' | ').slice(0, 220)
  throw new Error(`Extraction failed (7z code ${res.code}): ${snippet}`)
}
