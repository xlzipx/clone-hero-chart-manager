// Orchestrátor fronty stahování → rozbalení → (konverze) → instalace.

import { EventEmitter } from 'events'
import { mkdtempSync, existsSync, mkdirSync, statSync } from 'fs'
import { copyFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import type { DownloadJob, JobStage, SongResult } from '../../shared/types'
import { downloadDriveFolder, downloadTo, guessFileName, isDriveFolder } from './download'
import { extract } from './extractor'
import {
  findArchiveFiles,
  findConFiles,
  findDtxEntries,
  isArchiveByMagic,
  isHtmlFile
} from './filetype'
import { convertCon, convertDtx } from './converter'
import { install } from './library'
import { extractSng, isSngFile } from './sngextract'

// Přípony, které z názvu odřízneme. NE obecné `.\w+$` — to by zmršilo názvy
// složek s tečkou (např. „Mr. Big - To Be With You").
const KNOWN_INPUT_EXT = /\.(zip|rar|7z|sng|rb3con|con|dtx|gda|chart|mid)$/i

/**
 * Minimální SongResult pro dávkově dropnutý lokální vstup. Název složky/souboru
 * bývá „Artist - Title", takže ho podle „ - " rozdělíme — jinak by se u instalace
 * poskládalo „Unknown artist - Artist - Title".
 */
function deriveLocalSong(path: string): SongResult {
  const base = basename(path).replace(KNOWN_INPUT_EXT, '').trim()
  let artist = 'Unknown artist'
  let title = base || 'Unknown title'
  const dash = base.indexOf(' - ')
  if (dash > 0 && dash < base.length - 3) {
    artist = base.slice(0, dash).trim() || 'Unknown artist'
    title = base.slice(dash + 3).trim() || base
  }
  return {
    key: `local:${path}`,
    fileId: null,
    songId: null,
    title,
    artist,
    album: '',
    year: null,
    genre: '',
    lengthSeconds: null,
    albumArtUrl: null,
    difficulties: {},
    expertOnly: null,
    charter: null,
    source: 'Local file',
    gameFormat: null,
    gameFormats: [],
    needsConversion: false,
    official: false,
    downloadUrl: null,
    downloadPageUrl: null,
    externalUrl: null,
    sizeBytes: null,
    downloads: null
  }
}

/** Vnitřní signál, že úlohu zrušil uživatel — odliší zrušení od reálné chyby. */
class CanceledError extends Error {
  constructor() {
    super('canceled')
    this.name = 'CanceledError'
  }
}

const TERMINAL: JobStage[] = ['done', 'error', 'canceled']

class JobManager extends EventEmitter {
  private jobs = new Map<string, DownloadJob>()
  private queue: string[] = []
  private running = false
  /** ID úloh, které uživatel zrušil (běžící se přeruší na příští kontrole). */
  private canceled = new Set<string>()
  /** Abort per běžící úloha — zabije právě probíhající child proces (konverze). */
  private aborters = new Map<string, AbortController>()

  getAll(): DownloadJob[] {
    return Array.from(this.jobs.values())
  }

  /** Odstraní dokončené/chybové/zrušené úlohy z historie. */
  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (TERMINAL.includes(job.stage)) this.jobs.delete(id)
    }
  }

  /**
   * Zruší úlohu. Zařazená (ještě neběžící) se zruší okamžitě a nikdy nespustí;
   * běžící se přeruší na nejbližší kontrole mezi kroky (rozdělané soubory jsou
   * jen v temp složce, kterou `runJob` ve `finally` smaže — do knihovny se tak
   * nic nedokončeného nedostane).
   */
  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job || TERMINAL.includes(job.stage)) return
    this.canceled.add(id)
    const qi = this.queue.indexOf(id)
    if (qi !== -1) {
      // Zařazená úloha ještě neběžela → rovnou terminál, runJob se jí nedotkne.
      this.queue.splice(qi, 1)
      this.setStage(id, 'canceled', 'Canceled')
      this.canceled.delete(id)
    }
    // Běžící úloha: zabij hned probíhající child proces (konverze onyx trvá
    // minuty). Konverze pak selže, `throwIfCanceled` / catch to vyhodnotí jako
    // zrušení. Bez abortu by uživatel čekal na doběhnutí celého kroku.
    this.aborters.get(id)?.abort()
  }

  /** Zruší VŠECHNY neukončené úlohy (tlačítko „Stop all"). */
  cancelAll(): void {
    for (const [id, job] of this.jobs) {
      if (!TERMINAL.includes(job.stage)) this.cancel(id)
    }
  }

  /** Hodí `CanceledError`, pokud byla úloha mezitím zrušena (kontrola mezi kroky). */
  private throwIfCanceled(id: string): void {
    if (this.canceled.has(id)) throw new CanceledError()
  }

  enqueue(song: SongResult, targetSubfolder?: string): string {
    const id = randomUUID()
    const job: DownloadJob = { id, song, targetSubfolder, stage: 'queued', progress: -1 }
    this.jobs.set(id, job)
    this.queue.push(id)
    this.emit('update', job)
    void this.pump()
    return id
  }

  /**
   * Zařadí lokální soubor (uživatel ho ručně stáhnul z MEGA/Mediafire/…)
   * do stejné pipeline – přeskočí krok stažení a jede rovnou extract → convert → install.
   */
  enqueueLocal(
    localPath: string,
    song: SongResult,
    targetSubfolder?: string
  ): string {
    const id = randomUUID()
    // Označíme job jako "local" pomocí speciálního URL schématu, aby runJob věděl,
    // že má použít lokální soubor.
    const localSong: SongResult = {
      ...song,
      downloadUrl: `local-file://${localPath}`,
      source: song.source || 'Local file'
    }
    const job: DownloadJob = {
      id,
      song: localSong,
      targetSubfolder,
      stage: 'queued',
      progress: -1
    }
    this.jobs.set(id, job)
    this.queue.push(id)
    this.emit('update', job)
    void this.pump()
    return id
  }

  /**
   * Hromadné zařazení dropnutých souborů/složek. Každý vstup se „rozbalí":
   *   - soubor → sám sebou,
   *   - složka s archivy → každý archiv zvlášť,
   *   - složka bez archivů → celá složka (obsahuje volné písně / DTX / CON / .sng).
   * Metadata se odvodí z názvu; cílová podsložka je společná pro celou dávku.
   */
  enqueueLocalBatch(paths: string[], targetSubfolder?: string): string[] {
    const inputs: string[] = []
    for (const p of paths) {
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        const archives = findArchiveFiles(p)
        if (archives.length > 0) inputs.push(...archives)
        else inputs.push(p)
      } else if (st.isFile()) {
        inputs.push(p)
      }
    }
    return inputs.map((input) => this.enqueueLocal(input, deriveLocalSong(input), targetSubfolder))
  }

  private update(id: string, patch: Partial<DownloadJob>): void {
    const job = this.jobs.get(id)
    if (!job) return
    Object.assign(job, patch)
    this.emit('update', { ...job })
  }

  private setStage(id: string, stage: JobStage, message?: string, progress = -1): void {
    this.update(id, { stage, message, progress })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        await this.runJob(id)
      }
    } finally {
      this.running = false
    }
  }

  private async runJob(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    const song = job.song
    const tmpRoot = mkdtempSync(join(tmpdir(), 'chsd-'))
    const aborter = new AbortController()
    this.aborters.set(id, aborter)

    try {
      this.throwIfCanceled(id) // zrušeno, než se vůbec začalo
      const url = song.downloadUrl || song.downloadPageUrl
      if (!url) throw new Error('Missing download link')
      if (/marketplace\.xbox\.com/.test(url)) {
        throw new Error('This is official DLC (Xbox Marketplace link) — cannot be downloaded.')
      }

      // 1) Stažení — speciální větev pro lokální soubor (drag-and-drop).
      let workDir = tmpRoot
      if (url.startsWith('local-file://')) {
        const localPath = url.slice('local-file://'.length)
        if (!existsSync(localPath)) {
          throw new Error(`Local file no longer exists: ${localPath}`)
        }
        if (statSync(localPath).isDirectory()) {
          // Dropnutá složka → zpracuj ji na místě (jen z ní čteme, install kopíruje
          // ven). findCon/findDtx/install si v ní najdou písně samy.
          workDir = localPath
        } else {
          const downloadPath = join(tmpRoot, basename(localPath))
          await copyFile(localPath, downloadPath)

          // Pokračuj stejnou cestou jako u stažených souborů.
          if (isArchiveByMagic(downloadPath)) {
            this.setStage(id, 'extracting', 'Extracting…')
            const exDir = join(tmpRoot, '_extracted')
            mkdirSync(exDir, { recursive: true })
            await extract(downloadPath, exDir)
            workDir = exDir
          } else if (await isSngFile(downloadPath)) {
            // .sng (Encore container) → vždy rozbalit, stejně jako u stažených
            // souborů. Starší Clone Hero single-file .sng nečte, ale složku
            // s notes.chart + song.ini ano.
            this.setStage(id, 'extracting', 'Unpacking .sng…')
            const exDir = join(tmpRoot, '_extracted')
            mkdirSync(exDir, { recursive: true })
            await extractSng(downloadPath, exDir, `${song.artist} - ${song.title}`)
            workDir = exDir
          } else if (isHtmlFile(downloadPath)) {
            throw new Error('Dropped file looks like a web page, not a song.')
          }
        }
      } else if (isDriveFolder(url)) {
        // Google Drive složka → stáhnout všechny soubory přímo do složky.
        this.setStage(id, 'downloading', 'Downloading Google Drive folder…', -1)
        const folderDir = join(tmpRoot, 'folder')
        await downloadDriveFolder(url, folderDir, (p) => {
          this.update(id, {
            stage: 'downloading',
            progress: p.progress,
            message: p.fileName ? `Downloading ${p.fileName}` : undefined
          })
        })
        workDir = folderDir
      } else {
        this.setStage(id, 'downloading', 'Downloading…', 0)
        const fileName = guessFileName(url) || 'download'
        const downloadPath = join(tmpRoot, fileName)
        // Throttle: aktualizuj UI nejvýš jednou na 1 % (jinak desítky updateů/s).
        let lastPct = -1
        await downloadTo(url, downloadPath, (p) => {
          const pct = Math.floor(Math.max(p.progress, 0) * 100)
          if (pct === lastPct) return
          lastPct = pct
          this.update(id, { stage: 'downloading', progress: p.progress })
        })

        // 2) Rozbalení (pokud archiv) — detekce podle obsahu, ne přípony
        // (Google Drive stahuje soubory bez přípony).
        if (isArchiveByMagic(downloadPath)) {
          this.setStage(id, 'extracting', 'Extracting…')
          const exDir = join(tmpRoot, '_extracted')
          mkdirSync(exDir, { recursive: true })
          await extract(downloadPath, exDir)
          workDir = exDir
        } else if (await isSngFile(downloadPath)) {
          // .sng (Encore container) → vždy rozbalit. Starší Clone Hero ho
          // jako single-file nečte, ale složku s notes.chart + song.ini ano.
          this.setStage(id, 'extracting', 'Unpacking .sng…')
          const exDir = join(tmpRoot, '_extracted')
          mkdirSync(exDir, { recursive: true })
          await extractSng(downloadPath, exDir, `${song.artist} - ${song.title}`)
          workDir = exDir
        } else if (isHtmlFile(downloadPath)) {
          throw new Error(
            'The link returned a web page, not a song file. Use the ⋮ menu → Open page in browser to download it manually.'
          )
        }
      }

      this.throwIfCanceled(id) // po stažení/rozbalení, před (dlouhou) konverzí
      // 3) Konverze (pokud potřeba) — nejdřív CON, jinak zkus DTXMania.
      const conFiles = findConFiles(workDir)
      let installSource = workDir
      if (conFiles.length > 0) {
        this.setStage(
          id,
          'converting',
          'Converting Rock Band audio — this can take a few minutes…',
          -1
        )
        const convOut = join(tmpRoot, '_converted')
        mkdirSync(convOut, { recursive: true })
        let done = 0
        for (const con of conFiles) {
          const dest = join(convOut, `song_${done}`)
          await convertCon(
            con,
            dest,
            (cp) => {
              const overall = (done + Math.max(cp.progress, 0)) / conFiles.length
              this.update(id, { stage: 'converting', progress: overall, message: cp.message })
            },
            aborter.signal
          )
          done++
        }
        installSource = convOut
      } else {
        const dtxEntries = findDtxEntries(workDir)
        if (dtxEntries.length > 0) {
          this.setStage(
            id,
            'converting',
            'Converting DTXMania song — this can take a few minutes…',
            -1
          )
          const convOut = join(tmpRoot, '_converted')
          mkdirSync(convOut, { recursive: true })
          let done = 0
          for (const dtx of dtxEntries) {
            const dest = join(convOut, `song_${done}`)
            await convertDtx(
              dtx,
              dest,
              (cp) => {
                const overall = (done + Math.max(cp.progress, 0)) / dtxEntries.length
                this.update(id, { stage: 'converting', progress: overall, message: cp.message })
              },
              aborter.signal
            )
            done++
          }
          installSource = convOut
        }
      }

      this.throwIfCanceled(id) // poslední šance před zápisem do knihovny
      // 4) Install into the library. Od tohoto bodu už NEpřerušujeme — instalace
      // je krátká a atomická (`uniqueDir` + kopie), takže do Songs se buď zapíše
      // celá píseň, nebo (při zrušení výše) vůbec nic.
      this.setStage(id, 'installing', 'Installing into library…')
      const { installedPaths } = await install(installSource, song, job.targetSubfolder)

      this.update(id, {
        stage: 'done',
        progress: 1,
        message: `Done (${installedPaths.length} ${installedPaths.length === 1 ? 'song' : 'songs'})`,
        installPath: installedPaths[0]
      })
    } catch (err) {
      // Zrušení uživatelem NENÍ chyba — vlastní terminální stav bez červené hlášky.
      if (err instanceof CanceledError || this.canceled.has(id)) {
        this.update(id, { stage: 'canceled', progress: -1, message: 'Canceled' })
      } else {
        this.update(id, {
          stage: 'error',
          progress: -1,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    } finally {
      this.canceled.delete(id)
      this.aborters.delete(id)
      try {
        // Rozdělaný obsah v temp → smazat (i po zrušení: nic nedokončeného nezůstane).
        if (existsSync(tmpRoot)) await rm(tmpRoot, { recursive: true, force: true })
      } catch {
        /* úklid best-effort */
      }
    }
  }
}

export const jobManager = new JobManager()
