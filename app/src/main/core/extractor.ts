// Rozbalování archivů přes moderní 7-Zip (zip / 7z / RAR5 / tar / gz).

import { existsSync } from 'fs'
import { join } from 'path'
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

/** Rozbalí archiv do cílové složky.
 *
 * 7z exit kódy:
 *   0 = OK
 *   1 = warning (extrahuje, ale s upozorněním – třeba i CRC u 1 souboru)
 *   2 = fatal error
 *   7 = bad command line
 *   8 = not enough memory
 *
 * Při CRC fail nebo "Headers Error" vrátíme srozumitelnou hlášku místo
 * raw 7z výstupu, který je technický a zalitý cestami souborů.
 */
export async function extract(archivePath: string, destDir: string): Promise<void> {
  const exe = sevenZipPath()
  // -p (prázdné heslo): u šifrovaného archivu 7z rovnou selže místo promptu.
  // -- : konec přepínačů, aby se archiv s názvem začínajícím „-" nepovažoval za switch.
  const res = await run(exe, ['x', '-y', '-p', `-o${destDir}`, '--', archivePath])
  if (res.code === 0) return

  const combined = (res.stdout + '\n' + res.stderr).toLowerCase()
  const crcFail = /crc failed|data error|headers error|wrong password/i.test(combined)
  const cantOpen = /can not open file as archive|is not archive/i.test(combined)

  if (crcFail) {
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
