// Stahování souborů z různých hostitelů.
//
// Podporováno: přímé URL, rhythmverse přesměrování (/download, /download_file),
// Google Drive (jeden soubor) a Mediafire. Google Drive SLOŽKY zatím nejsou
// podporované (vyhodí srozumitelnou chybu s odkazem na ruční stažení).

import { createWriteStream, mkdirSync } from 'fs'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export interface DownloadProgress {
  /** 0..1, nebo -1 pokud není známá velikost. */
  progress: number
  receivedBytes: number
  totalBytes: number | null
}

export interface ResolvedDownload {
  /** Finální URL ke stažení. */
  url: string
  /** Navržený název souboru (může být přepsán z Content-Disposition). */
  fileName: string | null
}

function extractDriveId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([^/]+)/,
    /[?&]id=([^&]+)/,
    /\/uc\?id=([^&]+)/,
    /\/open\?id=([^&]+)/
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

export function isDriveFolder(url: string): boolean {
  return /drive\.google\.com\/.*\/folders\//.test(url)
}

function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'file'
}

export interface DriveEntry {
  id: string
  name: string
  isFolder: boolean
}

/**
 * Vylistuje obsah veřejné Google Drive složky scrapováním HTML stránky.
 * ID souborů jsou v `data-id`, názvy v `aria-label`; páruje se podle pořadí řádků.
 */
export async function listDriveFolder(folderId: string): Promise<DriveEntry[]> {
  const res = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
  })
  const html = await res.text()

  const idMatches = [...html.matchAll(/data-id="([^"]+)"/g)].filter((m) => m[1] !== '_gd')
  const groups: { id: string; pos: number }[] = []
  for (const m of idMatches) {
    const id = m[1]
    const last = groups[groups.length - 1]
    if (!last || last.id !== id) groups.push({ id, pos: m.index ?? 0 })
  }

  const entries: DriveEntry[] = []
  for (let i = 0; i < groups.length; i++) {
    const start = groups[i].pos
    const end = i + 1 < groups.length ? groups[i + 1].pos : html.length
    const slice = html.slice(start, end)
    const fm = slice.match(/aria-label="([^"]+\.[a-z0-9]{2,5})(?:\s[^"]*)?"/i)
    const gm = slice.match(/aria-label="([^"]+?)(?:\s+(?:Folder|File|Audio|Image|Video|Text|PDF)[^"]*)?"/i)
    const name = fm ? fm[1] : gm ? gm[1] : groups[i].id
    const isFolder = !/\.[a-z0-9]{2,5}$/i.test(name)
    entries.push({ id: groups[i].id, name: sanitizeFileName(name), isFolder })
  }
  return entries
}

/** Stáhne celou Google Drive složku (rekurzivně) do `destDir`. */
export async function downloadDriveFolder(
  url: string,
  destDir: string,
  onProgress?: (p: DownloadProgress & { fileName?: string }) => void,
  depth = 0,
  signal?: AbortSignal
): Promise<void> {
  if (depth > 4) return
  const folderId = extractFolderId(url)
  if (!folderId) throw new Error('Invalid Google Drive folder link')

  const entries = await listDriveFolder(folderId)
  if (entries.length === 0) {
    throw new Error('The Google Drive folder is empty or not publicly accessible')
  }

  const files = entries.filter((e) => !e.isFolder)
  const folders = entries.filter((e) => e.isFolder)

  mkdirSync(destDir, { recursive: true })
  let done = 0
  for (const f of files) {
    onProgress?.({
      progress: files.length ? done / files.length : -1,
      receivedBytes: 0,
      totalBytes: null,
      fileName: f.name
    })
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await downloadTo(
      `https://drive.google.com/uc?id=${f.id}&export=download`,
      join(destDir, f.name),
      undefined,
      signal
    )
    done++
  }
  for (const sub of folders) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await downloadDriveFolder(
      `https://drive.google.com/drive/folders/${sub.id}`,
      join(destDir, sub.name),
      onProgress,
      depth + 1,
      signal
    )
  }
}

function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, '').trim())
    } catch {
      /* ignore */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1].trim() : null
}

const SHORTENERS =
  /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|rb\.gy|cutt\.ly|is\.gd|shorturl\.at|adf\.ly)$/i

/** Rozbalí zkracovač odkazů (bit.ly apod.) na finální URL. */
export async function expandShortlink(url: string): Promise<string> {
  try {
    const host = new URL(url).hostname
    if (!SHORTENERS.test(host)) return url
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } })
    const final = res.url || url
    try {
      await res.body?.cancel()
    } catch {
      /* ignore */
    }
    return final
  } catch {
    return url
  }
}

/** Vyřeší Mediafire stránku na přímý odkaz (funguje pro /file/ i /download/). */
async function resolveMediafire(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  const html = await res.text()
  const m =
    html.match(/href="((?:https?:)?\/\/download\d+\.mediafire\.com\/[^"]+)"/i) ||
    html.match(/(https?:\/\/download\d+\.mediafire\.com\/[^"'\s]+)/i)
  if (!m) {
    throw new Error('Could not find a direct Mediafire link (open the page in your browser).')
  }
  let link = m[1].replace(/&amp;/g, '&')
  if (link.startsWith('//')) link = 'https:' + link
  return link
}

/** Vyřeší zdrojové URL na finální stažitelnou adresu. */
export async function resolve(url: string): Promise<ResolvedDownload> {
  url = await expandShortlink(url)

  // Google Drive
  if (/drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com/.test(url)) {
    if (isDriveFolder(url)) {
      throw new Error(
        'This chart is a Google Drive FOLDER — handled separately. Open the link and download manually if this fails.'
      )
    }
    const id = extractDriveId(url)
    if (!id) throw new Error('Could not extract the file ID from the Google Drive link')
    return {
      url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      fileName: null
    }
  }
  // MEGA – šifrované, nejde stáhnout přes HTTP
  if (/mega\.(nz|co\.nz)/i.test(url)) {
    throw new Error(
      'Hosted on MEGA, which can’t be downloaded automatically. Use the ⋮ menu → Open page in browser.'
    )
  }
  // Mediafire (libovolná cesta)
  if (/mediafire\.com/i.test(url)) {
    return { url: await resolveMediafire(url), fileName: null }
  }
  // Dropbox → vynuť přímé stažení
  if (/dropbox\.com/i.test(url)) {
    try {
      const u = new URL(url)
      u.searchParams.set('dl', '1')
      return { url: u.toString(), fileName: null }
    } catch {
      /* ignore */
    }
  }
  // rhythmverse a přímé odkazy – fetch následuje redirecty sám.
  return { url, fileName: null }
}

/** Stáhne URL na disk – vlastní implementace pro jednu iteraci.
 *  Vrací počet stažených bajtů a očekávanou velikost (pro validaci). */
async function downloadOnce(
  url: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<{ received: number; total: number | null }> {
  let res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal
  })

  // Google Drive virus-scan mezistránka: HTML s confirm formulářem.
  const ctype = res.headers.get('content-type') || ''
  if (ctype.includes('text/html') && /google\.com/.test(url)) {
    const html = await res.text()
    const action = html.match(/action="([^"]+)"/i)
    if (!action) {
      throw new Error(
        'Google Drive download is not available (quota exceeded, private, or sign-in required). Use the ⋮ menu → Open page in browser.'
      )
    }
    const params: Record<string, string> = {}
    for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/gi)) {
      params[m[1]] = m[2]
    }
    const u = new URL(action[1].replace(/&amp;/g, '&'))
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    res = await fetch(u.toString(), { headers: { 'User-Agent': UA }, redirect: 'follow', signal })
  }

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || null
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as any)

  // KRITICKÉ: počítadlo MUSÍ být Transform uvnitř pipeline. Kdybychom použili
  // `nodeStream.on('data', …)`, stream by přešel do flowing módu IHNED a chunky
  // by začaly téct dřív, než `pipeline()` stihne napojit `createWriteStream`.
  // Část dat by se ztratila → soubor by byl "skoro správný" (Content-Length
  // sedí, ale uvnitř archivu chybí bajty → 7z CRC fail).
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb): void {
      received += chunk.length
      if (onProgress) {
        onProgress({
          progress: total ? received / total : -1,
          receivedBytes: received,
          totalBytes: total
        })
      }
      cb(null, chunk)
    }
  })

  // `signal` do pipeline → při cancelu se stream i zápis okamžitě zničí a
  // pipeline vyhodí AbortError (jinak by se soubor dostahoval celý a zrušení
  // by se projevilo až po dokončení).
  await pipeline(nodeStream, counter, createWriteStream(destPath), { signal })
  return { received, total }
}

/** Stáhne soubor na disk a ověří úplnost. Truncated download → retry, pak vyhodí chybu. */
export async function downloadTo(
  sourceUrl: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const resolved = await resolve(sourceUrl)

  // Max 2 pokusy – druhý jen pokud server hlásil Content-Length a my dostali míň.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { received, total } = await downloadOnce(resolved.url, destPath, onProgress, signal)

    // Bez Content-Length nemůžeme validovat — věříme, že to dopadlo.
    if (total === null) return
    // Tolerujeme drobnou odchylku (chunked, padding) — vyžadujeme aspoň 99 % očekávaného.
    if (received >= Math.floor(total * 0.99)) return

    if (attempt === 1) {
      // Retry — nějaké hosty občas zavřou spojení předčasně.
      continue
    }
    throw new Error(
      `Download was truncated (got ${received} of ${total} bytes). The host closed the connection early — try again, or use the ⋮ menu to open in browser.`
    )
  }
}

/** Odhadne název souboru z URL (bez query). */
export function guessFileName(url: string): string {
  try {
    const u = new URL(url)
    const base = u.pathname.split('/').filter(Boolean).pop() || 'download'
    return decodeURIComponent(base)
  } catch {
    return 'download'
  }
}
