// Detekce typů souborů (CON/LIVE balíčky vs. ostatní).
//
// VŠECHNO je tu asynchronní schválně. Dřív se stromy procházely synchronně
// (`readdirSync`/`statSync`/`readSync`), jenže tyhle skeny běží v MAIN procesu
// po každé extrakci — u velkého packu se stovkami písní tím stál celý main,
// takže se zastavilo IPC, hlášení postupu i překreslování okna a appka
// vypadala zaseklá. S `fs/promises` se mezi soubory event loop nadechne.

import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import { join } from 'path'

/**
 * Kolik souborů kontrolovat najednou. Sekvenčně je to zbytečně pomalé (každý
 * soubor = otevřít + přečíst + zavřít), úplně bez omezení by zas šlo narazit
 * na strop otevřených deskriptorů u packů s tisíci soubory.
 */
const IO_CONCURRENCY = 8

/** Přečte prvních `len` bajtů souboru. Kratší/nečitelný soubor → prázdný buffer. */
async function head(path: string, len: number): Promise<Buffer> {
  let fh: fsp.FileHandle | null = null
  try {
    fh = await fsp.open(path, 'r')
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, 0)
    return buf.subarray(0, bytesRead)
  } catch {
    return Buffer.alloc(0)
  } finally {
    await fh?.close().catch(() => undefined)
  }
}

/** True, pokud je soubor Xbox STFS balíček (CON/LIVE/PIRS) – tj. Rock Band CON. */
export async function isConFile(path: string): Promise<boolean> {
  const lower = path.toLowerCase()
  if (lower.endsWith('.rb3con') || lower.endsWith('.con')) return true
  const m = (await head(path, 4)).toString('latin1')
  return m === 'CON ' || m === 'LIVE' || m === 'PIRS'
}

/**
 * Detekuje archiv podle magic bytů (spolehlivější než přípona — Google Drive
 * stahuje soubory bez přípony). Vrací true pro zip/7z/rar/gzip.
 */
export async function isArchiveByMagic(path: string): Promise<boolean> {
  const buf = await head(path, 6)
  if (buf.length < 2) return false
  // ZIP: 50 4B  | 7z: 37 7A BC AF 27 1C | RAR: 52 61 72 21 | GZIP: 1F 8B
  if (buf[0] === 0x50 && buf[1] === 0x4b) return true
  if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return true
  if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return true
  if (buf[0] === 0x1f && buf[1] === 0x8b) return true
  return false
}

/** True, pokud soubor začíná jako HTML (odkaz vrátil webovou stránku, ne song). */
export async function isHtmlFile(path: string): Promise<boolean> {
  const head64 = (await head(path, 64)).toString('latin1').trim().toLowerCase()
  return (
    head64.startsWith('<!doctype') || head64.startsWith('<html') || head64.startsWith('<?xml')
  )
}

/** Načte položky adresáře i s typem (soubor/složka) — ušetří `stat` u každé. */
async function readDir(dir: string): Promise<Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Pustí `fn` nad položkami po dávkách, ať neteče příliš mnoho deskriptorů naráz. */
async function filterLimited<T>(items: T[], fn: (item: T) => Promise<boolean>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < items.length; i += IO_CONCURRENCY) {
    const batch = items.slice(i, i + IO_CONCURRENCY)
    const keep = await Promise.all(batch.map(fn))
    batch.forEach((item, j) => keep[j] && out.push(item))
  }
  return out
}

/**
 * Projde strom a na každé úrovni předá soubory `collect`. Do složek sestupuje
 * po jedné (paralelizuje se až kontrola souborů uvnitř), ať u hlubokého stromu
 * neroste počet otevřených adresářů donekonečna.
 */
async function walkTree(
  root: string,
  maxDepth: number,
  collect: (dir: string, files: Dirent[]) => Promise<void>
): Promise<void> {
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    const entries = await readDir(dir)
    await collect(
      dir,
      entries.filter((e) => e.isFile())
    )
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(root, 0)
}

/** Najde všechny CON balíčky v adresářovém stromu. */
export async function findConFiles(root: string, maxDepth = 6): Promise<string[]> {
  // `root` může být rovnou soubor (stažený .rb3con bez archivu).
  const st = await fsp.stat(root).catch(() => null)
  if (st?.isFile()) return (await isConFile(root)) ? [root] : []

  const out: string[] = []
  await walkTree(root, maxDepth, async (dir, files) => {
    const paths = files.map((e) => join(dir, e.name))
    // Prázdný soubor magic kontrolu neprojde sám (přečte se 0 bajtů), takže
    // původní `size > 0` test je zbytečný a ušetří se `stat` u každé položky.
    out.push(...(await filterLimited(paths, isConFile)))
  })
  return out
}

/** Najde všechny archivy (zip/rar/7z/gzip podle magic) v adresářovém stromu. */
export async function findArchiveFiles(root: string, maxDepth = 8): Promise<string[]> {
  const out: string[] = []
  await walkTree(root, maxDepth, async (dir, files) => {
    const paths = files.map((e) => join(dir, e.name))
    out.push(...(await filterLimited(paths, isArchiveByMagic)))
  })
  return out
}

/**
 * Najde vstupní body pro DTXMania konverzi ve stromu.
 * - Preferuje `set.def` (import celé sady = Expert + autogen nižší obtížnosti);
 *   jeden set.def = jedna píseň (packy mají víc podsložek).
 * - Když žádný set.def není, vezme jeden `.dtx`/`.gda` na složku (soubory v jedné
 *   složce jsou obtížnosti jedné písně → jinak by vznikly duplikáty).
 */
export async function findDtxEntries(root: string, maxDepth = 6): Promise<string[]> {
  const setDefs: string[] = []
  const dtxByDir = new Map<string, string>()
  await walkTree(root, maxDepth, async (dir, files) => {
    for (const e of files) {
      const lower = e.name.toLowerCase()
      const full = join(dir, e.name)
      // Tady se rozhoduje podle NÁZVU, takže se čte jen velikost — a jen
      // u kandidátů, ne u každého souboru ve stromu.
      if (lower === 'set.def') {
        if (await hasBytes(full)) setDefs.push(full)
      } else if ((lower.endsWith('.dtx') || lower.endsWith('.gda')) && !dtxByDir.has(dir)) {
        if (await hasBytes(full)) dtxByDir.set(dir, full)
      }
    }
  })
  return setDefs.length > 0 ? setDefs : [...dtxByDir.values()]
}

/** Neprázdný soubor? (prázdné `set.def`/`.dtx` by konverzi jen shodily) */
async function hasBytes(path: string): Promise<boolean> {
  const st = await fsp.stat(path).catch(() => null)
  return !!st && st.isFile() && st.size > 0
}
