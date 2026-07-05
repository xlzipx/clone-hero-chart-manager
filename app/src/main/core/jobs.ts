// Orchestrátor fronty stahování → rozbalení → (konverze) → instalace.

import { EventEmitter } from 'events'
import { copyFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import type { DownloadJob, JobStage, SongResult } from '../../shared/types'
import { downloadDriveFolder, downloadTo, guessFileName, isDriveFolder } from './download'
import { extract } from './extractor'
import { findConFiles, findDtxEntries, isArchiveByMagic, isHtmlFile } from './filetype'
import { convertCon, convertDtx } from './converter'
import { install } from './library'
import { extractSng, isSngFile } from './sngextract'

class JobManager extends EventEmitter {
  private jobs = new Map<string, DownloadJob>()
  private queue: string[] = []
  private running = false

  getAll(): DownloadJob[] {
    return Array.from(this.jobs.values())
  }

  /** Odstraní dokončené/chybové úlohy z historie. */
  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.stage === 'done' || job.stage === 'error') this.jobs.delete(id)
    }
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

    try {
      const url = song.downloadUrl || song.downloadPageUrl
      if (!url) throw new Error('Missing download link')
      if (/marketplace\.xbox\.com/.test(url)) {
        throw new Error('This is official DLC (Xbox Marketplace link) — cannot be downloaded.')
      }

      // 1) Stažení — speciální větev pro lokální soubor (drag-and-drop).
      let workDir = tmpRoot
      if (url.startsWith('local-file://')) {
        const localPath = url.slice('local-file://'.length)
        if (!existsSync(localPath) || !statSync(localPath).isFile()) {
          throw new Error(`Local file no longer exists: ${localPath}`)
        }
        const downloadPath = join(tmpRoot, basename(localPath))
        copyFileSync(localPath, downloadPath)

        // Pokračuj stejnou cestou jako u stažených souborů.
        if (isArchiveByMagic(downloadPath)) {
          this.setStage(id, 'extracting', 'Extracting…')
          const exDir = join(tmpRoot, '_extracted')
          mkdirSync(exDir, { recursive: true })
          await extract(downloadPath, exDir)
          workDir = exDir
        } else if (isHtmlFile(downloadPath)) {
          throw new Error('Dropped file looks like a web page, not a song.')
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
          await convertCon(con, dest, (cp) => {
            const overall = (done + Math.max(cp.progress, 0)) / conFiles.length
            this.update(id, { stage: 'converting', progress: overall, message: cp.message })
          })
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
            await convertDtx(dtx, dest, (cp) => {
              const overall = (done + Math.max(cp.progress, 0)) / dtxEntries.length
              this.update(id, { stage: 'converting', progress: overall, message: cp.message })
            })
            done++
          }
          installSource = convOut
        }
      }

      // 4) Install into the library
      this.setStage(id, 'installing', 'Installing into library…')
      const { installedPaths } = install(installSource, song, job.targetSubfolder)

      this.update(id, {
        stage: 'done',
        progress: 1,
        message: `Done (${installedPaths.length} ${installedPaths.length === 1 ? 'song' : 'songs'})`,
        installPath: installedPaths[0]
      })
    } catch (err) {
      this.update(id, {
        stage: 'error',
        progress: -1,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      try {
        if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        /* úklid best-effort */
      }
    }
  }
}

export const jobManager = new JobManager()
