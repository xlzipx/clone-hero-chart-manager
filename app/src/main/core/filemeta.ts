// Nahlédnutí do lokálního souboru pro získání artist + title bez plného rozbalení.
//
// .sng: parser čte JEN header (~první KB), takže instantní.
// .zip/.rar/.7z: extrakce song.ini přes 7z je drahá, neděláme — necháme to
// na heuristice z názvu souboru.

import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { SngStream } from 'parse-sng'
import { isSngFile } from './sngextract'

export interface FileMeta {
  artist: string
  title: string
}

/** Z headeru .sng vytáhne `artist` + `name` z metadata mapy. */
async function readSngMeta(path: string): Promise<FileMeta | null> {
  try {
    const nodeStream = createReadStream(path)
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    const sng = new SngStream(webStream, { generateSongIni: false })
    return await new Promise<FileMeta | null>((resolve) => {
      let done = false
      const finish = (result: FileMeta | null): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        // Stream už nepotřebujeme — zrušíme ho, ať se Node nevyplýtvá čtením celého souboru.
        nodeStream.destroy()
        resolve(result)
      }
      // Pojistka: useknutý/vadný .sng nemusí vyslat ani `header`, ani `error`
      // (stream jen skončí) — bez timeoutu by `invoke` v rendereru visel navždy.
      const timer = setTimeout(() => finish(null), 10_000)
      nodeStream.on('close', () => finish(null))
      sng.on('error', () => finish(null))
      sng.on('header', (header) => {
        const m = header.metadata || {}
        const artist = (m.artist || m.band || '').trim()
        const title = (m.name || m.title || '').trim()
        finish(artist || title ? { artist, title } : null)
      })
      sng.start()
    })
  } catch {
    return null
  }
}

/** Public: vrátí metadata z lokálního souboru, nebo null pokud nelze určit. */
export async function peekFileMeta(path: string): Promise<FileMeta | null> {
  if (await isSngFile(path)) {
    return readSngMeta(path)
  }
  // Pro archivy zatím nemáme rychlou cestu — pojede heuristika v rendereru.
  return null
}
