// Rozbalení .sng (Songs Next Generation) kontejneru do CH-kompatibilní složky.
//
// .sng je single-file formát z Encore: header + XOR-masked file table + obsah.
// Clone Hero ho čte nativně až od v1.0 (2024). Starší verze ho ignorují,
// proto vždycky raději rozbalíme do plné složky.

import { createReadStream, createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { SngStream } from 'parse-sng'
import { asError } from '../../shared/errors'
import { portableName } from '../../shared/foldertemplate'

/** Magic prefix `SNGPKG` (ASCII). */
const SNG_MAGIC = Buffer.from([0x53, 0x4e, 0x47, 0x50, 0x4b, 0x47])

/** Bezpečné jméno složky/souboru (žádné Windows zakázané znaky). */
function sanitize(name: string): string {
  return portableName(name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()) || 'song'
}

/** Detekuje .sng podle magic bytů — robustnější než přípona. */
export async function isSngFile(filePath: string): Promise<boolean> {
  try {
    const fd = createReadStream(filePath, { start: 0, end: 5 })
    const chunks: Buffer[] = []
    for await (const c of fd) chunks.push(c as Buffer)
    const head = Buffer.concat(chunks).subarray(0, 6)
    return head.length === 6 && head.equals(SNG_MAGIC)
  } catch {
    return false
  }
}

/**
 * Rozbalí .sng soubor do `outDir`. Vytvoří podsložku pojmenovanou podle
 * `name` (typicky "Artist - Title"), do ní zapíše všechny soubory + song.ini.
 *
 * `parse-sng` poskytuje SngStream s eventy `header` a `file`. Při `file` se
 * musí volat `nextFile()` aby zpracoval další; pokud je nextFile null, jsme
 * na konci.
 */
export async function extractSng(
  sngPath: string,
  outDir: string,
  name: string
): Promise<string> {
  const songDir = join(outDir, sanitize(name))
  await mkdir(songDir, { recursive: true })

  // parse-sng očekává Web ReadableStream. Převedeme Node read stream
  // (cast přes unknown – Node typings nejsou s lib.dom ReadableStream<T> kompatibilní).
  const nodeStream = createReadStream(sngPath)
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
  const sng = new SngStream(webStream, { generateSongIni: true })

  await new Promise<void>((resolve, reject) => {
    let pending: Promise<void> = Promise.resolve()
    let settled = false
    let timer: NodeJS.Timeout

    // Inaktivní timeout: .sng je už na disku, rozbalení je lokální I/O a rychlé.
    // Kdyby stream vyslal `header`, ale žádné `file` eventy (prázdný/uříznutý
    // nebo parserem nepobraný .sng), Promise by se nikdy nevyřešila → zablokovala
    // by CELOU frontu (pump na ni čeká) a neuklidil by se temp. Proto po delší
    // nečinnosti radši odmítneme. Timer se resetuje při každém souboru.
    const finish = (err?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Zavři zdrojový read stream, ať se při timeout/chybě neleakuje file handle
      // (write stream aktuálního souboru dobíhá přes pipeline a uzavře se sám).
      nodeStream.destroy()
      if (err) reject(asError(err))
      else resolve()
    }
    const arm = (): void => {
      clearTimeout(timer)
      timer = setTimeout(
        () => finish(new Error('Unpacking the .sng timed out — it may be empty or corrupt.')),
        60_000
      )
    }
    arm()

    sng.on('error', (err: unknown) => finish(err))

    sng.on('file', (fileName: string, fileStream: ReadableStream<Uint8Array>, nextFile) => {
      arm() // aktivita → resetuj timeout
      const safe = sanitize(fileName)
      const dest = join(songDir, safe)
      const writeNode = Readable.fromWeb(fileStream as unknown as Parameters<typeof Readable.fromWeb>[0])
      // Sequence: zapiš tenhle soubor, pak teprve nextFile() nebo resolve.
      pending = pending
        .then(() => pipeline(writeNode, createWriteStream(dest)))
        .then(() => {
          if (nextFile) nextFile()
          else finish()
        })
        .catch((e) => finish(e))
    })

    sng.start()
  })

  return songDir
}
