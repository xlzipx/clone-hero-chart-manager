// Skutečná ukázka chartu z Chorus Encore — bez stažení celého souboru.
//
// Encore hostuje charty jako `.sng`, což je kontejner s hlavičkou, ve které
// stojí, KDE uvnitř který soubor leží. Server navíc umí Range požadavky, takže
// se dá vytáhnout jen to, co je potřeba:
//
//   1. prvních ~64 kB  → hlavička se seznamem souborů a maskovacím klíčem
//   2. `song.ini`      → `preview_start_time` (kam ukázku mířit) + délka
//   3. začátek audia   → hlavičkové stránky, bez nich se nedá dekódovat
//   4. kus od odhadnuté pozice → vlastní zvuk
//
// Dohromady kolem 600 kB místo desítek MB. Nic se neukládá na disk, bajty jdou
// rovnou do rendereru a ten je přehraje z paměti (stejně jako online ukázku).
//
// Oproti `preview.ts` (párování na iTunes/Deezer) tady zní PŘESNĚ ten chart,
// na který se uživatel dívá — včetně coverů a fanouškovských verzí, které
// hudební služby vůbec neznají.

import { app } from 'electron'
import { SngStream } from 'parse-sng'
import type { SngPreview } from '../../shared/types'

/** Kolik stáhnout na hlavičku `.sng`. Seznam souborů bývá výrazně menší. */
const HEADER_BYTES = 64 * 1024
/** Kus ze začátku audia, ve kterém se hledají hlavičkové stránky kodeku. */
const CODEC_HEAD_BYTES = 16 * 1024
/** Kolik zvuku stáhnout. 30 s Opusu je zhruba 400 kB, tohle je rezerva. */
const AUDIO_BYTES = 512 * 1024

const AUDIO_RE = /\.(opus|ogg)$/i

function ua(): string {
  return `CHM/${app.getVersion()}`
}

/** Stáhne daný rozsah bajtů. `null` = server Range nepodporuje nebo selhal. */
async function fetchRange(url: string, start: number, len: number): Promise<Buffer | null> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { 'User-Agent': ua(), Range: `bytes=${start}-${start + len - 1}` }
    })
    // 206 = server rozsah respektoval. Na 200 by přišel CELÝ soubor, což je
    // přesně to, čemu se tu vyhýbáme → radši to vzdáme.
    if (res.status !== 206) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Odmaskuje data `.sng`. Klíč se odvíjí od pozice UVNITŘ daného souboru, ne
 * od pozice v archivu — díky tomu jde číst i z jeho prostředka.
 */
function unmask(buf: Buffer, mask: Uint8Array, fileOffset: number): Buffer {
  const out = Buffer.alloc(buf.length)
  let ci = fileOffset % 256
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ (mask[ci % 16] ^ ci)
    ci = (ci + 1) % 256
  }
  return out
}

interface OggPage {
  /** Celková délka stránky v bajtech (hlavička + segmenty). */
  size: number
  /** Pozice ve zvuku ve vzorcích. Hlavičkové stránky mají 0. */
  granule: bigint
}

/**
 * Přečte hlavičku Ogg stránky na dané pozici. `null` = tady stránka nezačíná.
 * Struktura: "OggS" + verze + typ + granule(8) + serial(4) + pořadí(4) +
 * kontrolní součet(4) + počet segmentů(1) + tabulka segmentů.
 */
function readOggPage(buf: Buffer, pos: number): OggPage | null {
  if (pos + 27 > buf.length) return null
  if (buf[pos] !== 0x4f || buf[pos + 1] !== 0x67 || buf[pos + 2] !== 0x67 || buf[pos + 3] !== 0x53)
    return null
  if (buf[pos + 4] !== 0) return null // verze musí být 0
  const segCount = buf[pos + 26]
  const tableEnd = pos + 27 + segCount
  if (tableEnd > buf.length) return null
  let dataLen = 0
  for (let i = 0; i < segCount; i++) dataLen += buf[tableEnd - segCount + i]
  return { size: 27 + segCount + dataLen, granule: buf.readBigUInt64LE(pos + 6) }
}

/**
 * Kde ve streamu končí hlavičky kodeku a začíná zvuk. Hlavičkové stránky mají
 * granule 0, takže první stránka s nenulovou granulí je první zvuk. Funguje
 * to pro Opus (2 hlavičky) i Vorbis (3, a klidně přes víc stránek).
 */
function audioStartOffset(buf: Buffer): number {
  let pos = 0
  while (pos < buf.length) {
    const page = readOggPage(buf, pos)
    if (!page) break
    if (page.granule > 0n) return pos
    pos += page.size
  }
  return pos
}

/**
 * Najde v bloku první hranici stránky. Značka `OggS` se může objevit i uvnitř
 * zvukových dat náhodou, takže se ověří i tím, že hned za stránkou začíná
 * další — dvě shody po sobě už náhoda prakticky nejsou.
 */
function findPageBoundary(buf: Buffer): number {
  for (let i = 0; i + 27 < buf.length; i++) {
    const page = readOggPage(buf, i)
    if (!page) continue
    if (readOggPage(buf, i + page.size)) return i
  }
  return -1
}

/**
 * Číselná hodnota z metadat hlavičky `.sng`. Hodnoty chodí jako řetězce a
 * chybějící údaje bývají `-1`, takže se záporné zahazují.
 */
function metaNumber(meta: Record<string, unknown> | undefined, key: string): number | null {
  const raw = meta?.[key]
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Vytáhne z `.sng` ukázku zvuku. Míří na `preview_start_time` ze `song.ini`
 * (kam ukázku pouští i hra); když ho chart nemá, hraje se od začátku.
 *
 * `null` = nepovedlo se (chybí Range, jiný formát, nečekaná struktura). Volající
 * pak spadne na online ukázku, takže selhání nic nerozbije.
 */
export async function getSngPreview(url: string): Promise<SngPreview | null> {
  const headBuf = await fetchRange(url, 0, HEADER_BYTES)
  if (!headBuf) return null

  // parse-sng čte Web stream; hlavička se vejde do toho, co jsme stáhli.
  let header: {
    xorMask: Uint8Array
    fileMeta: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
  } | null = null
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(headBuf))
        c.close()
      }
    })
    const sng = new SngStream(stream)
    header = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000)
      sng.on('header', (h) => {
        clearTimeout(timer)
        resolve(h as never)
      })
      sng.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })
      sng.start()
    })
  } catch {
    return null
  }
  if (!header?.fileMeta?.length) return null

  const fileAt = (test: (name: string) => boolean): { off: number; len: number } | null => {
    const f = header.fileMeta.find((x) => test(String(x.filename)))
    if (!f) return null
    return { off: Number(f.contentsIndex), len: Number(f.contentsLen) }
  }

  // POZOR na pořadí: charty se stopami mají uvnitř víc audio souborů a v tabulce
  // bývá první `guitar.opus` — vzít „první, co je zvuk" by v ukázce pustilo
  // samotnou kytaru (ověřeno na živých datech). Priorita je proto explicitní:
  //   1. `preview.*` — hotová ukázka od chartera, přesně to, co chtěl slyšet
  //   2. `song.*`    — plný mix (u stopově dělených jen doprovod, ale celá píseň)
  //   3. cokoli zbylo
  const named = (re: RegExp): { off: number; len: number } | null =>
    fileAt((n) => AUDIO_RE.test(n) && re.test(n))
  const ready = named(/^preview\./i)
  const audio = ready ?? named(/^song\./i) ?? fileAt((n) => AUDIO_RE.test(n))
  if (!audio || audio.len <= 0) return null

  // Odkud pouštět si říká chart sám. POZOR: `.sng` NEMÁ uvnitř `song.ini` —
  // metadata (včetně `preview_start_time`) jsou přímo v hlavičce archivu,
  // takže je máme zadarmo z toho, co už je stažené.
  let startByte = 0
  const previewMs = metaNumber(header.metadata, 'preview_start_time')
  const lengthMs = metaNumber(header.metadata, 'song_length')
  // `preview.*` je už hotový výřez — skákat v něm by ukázku posunulo mimo to,
  // co charter zamýšlel. Hledá se jen v plné skladbě.
  if (!ready && previewMs !== null && lengthMs !== null && previewMs > 0 && previewMs < lengthMs) {
    // Odhad přes poměr: Opus má proměnný datový tok, takže to nesedí na
    // sekundu, ale míří to tam, kam charter zamýšlel.
    startByte = Math.floor(audio.len * (previewMs / lengthMs))
    // Nech dost místa na celou ukázku, ať neskončíme na konci souboru.
    startByte = Math.min(startByte, Math.max(0, audio.len - AUDIO_BYTES))
  }

  // Hlavičkové stránky kodeku ze začátku — bez nich není co inicializovat.
  const introRaw = await fetchRange(url, audio.off, Math.min(CODEC_HEAD_BYTES, audio.len))
  if (!introRaw) return null
  const intro = unmask(introRaw, header.xorMask, 0)
  const introEnd = audioStartOffset(intro)
  if (introEnd <= 0) return null

  // Od začátku? Pak stačí jeden souvislý kus a není co slepovat.
  if (startByte <= introEnd) {
    const raw = await fetchRange(url, audio.off, Math.min(AUDIO_BYTES, audio.len))
    if (!raw) return null
    return { data: toArrayBuffer(unmask(raw, header.xorMask, 0)), mime: 'audio/ogg', fromStart: true }
  }

  const midRaw = await fetchRange(url, audio.off + startByte, Math.min(AUDIO_BYTES, audio.len - startByte))
  if (!midRaw) return null
  const mid = unmask(midRaw, header.xorMask, startByte)
  const cut = findPageBoundary(mid)
  if (cut < 0) return null // netrefili jsme se do stránek → radši nic

  return {
    data: toArrayBuffer(Buffer.concat([intro.subarray(0, introEnd), mid.subarray(cut)])),
    mime: 'audio/ogg',
    fromStart: false
  }
}

/** Buffer → ArrayBuffer bez kopie celého poolu (Node buffery sdílí paměť). */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
