// IPC handlery mezi main a renderer procesem.

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import type {
  Database,
  FilterOptions,
  RhythmVerseSystem,
  SearchFilters,
  SearchResponse,
  SongResult,
  SortKey
} from '../shared/types'
import { getConfig, setConfig } from './core/config'
import { search as searchEnchor } from './core/enchor'
import { peekFileMeta } from './core/filemeta'
import {
  bringGameToFront,
  chExeStatus,
  runningGame,
  yargExeStatus
} from './core/gamedetect'
import { hideReminder, showReminder } from './reminder'
import { jobManager } from './core/jobs'
import { invalidateOwnedIndex, listSongFolders, ownedFolders, ownedSongKeys } from './core/library'
import {
  libAddToPlaylist,
  libCopy,
  libCreateFolder,
  libDeletePlaylist,
  libFindDuplicates,
  libFolderCounts,
  libList,
  libListPlaylists,
  libMove,
  libMoveOut,
  libOpen,
  libPlaylistSongs,
  libReadMeta,
  libRemoveFromPlaylist,
  libSongDetail,
  libSongInfo,
  libRename,
  libRenamePlaylist,
  libReveal,
  libTrash,
  libWriteMeta
} from './core/librarymgr'
import type { SongMeta } from '../shared/types'
import { invalidateLibraryIndex } from './core/playlists'
import { getPreview } from './core/preview'
import { fetchFilterOptions, search as searchRhythmverse } from './core/rhythmverse'
import { resolveSpotifyPlaylist } from './core/spotify'
import { getReleaseNotes, getReleaseNotesSince } from './core/update'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { applyUiScale, getOverlay, hideOverlay } from './overlay'

let ipcRegistered = false
let gamePollHandle: NodeJS.Timeout | null = null

export function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle(
    'search',
    async (
      _e,
      text: string,
      page: number,
      records: number,
      system?: RhythmVerseSystem,
      database?: Database,
      filters?: SearchFilters,
      sort?: SortKey
    ): Promise<SearchResponse> => {
      const db: Database = database ?? 'rhythmverse'
      if (db === 'enchor') {
        return searchEnchor(text, page, records, filters, sort)
      }
      if (db === 'both') {
        // Žánr / rok / délku umí serverově jen RhythmVerse. Když je některý
        // aktivní, Encore by vrátil NEfiltrovaný katalog a „prosákl" do výsledků
        // (a nafoukl by total) → v tom případě procházej jen RhythmVerse.
        const rvOnlyFilter = !!(
          filters?.genre?.length ||
          filters?.year?.length ||
          filters?.decade?.length ||
          filters?.songLength?.length
        )
        if (rvOnlyFilter) {
          return searchRhythmverse(text, page, records, system ?? 'ch', filters, sort)
        }
        // Spojený režim: stáhne první stránku z obou a dedupuje.
        const [rv, en] = await Promise.allSettled([
          searchRhythmverse(text, page, records, system ?? 'ch', filters, sort),
          searchEnchor(text, page, records, filters, sort)
        ])
        // Spadly-li OBĚ, propaguj chybu (jinak by prázdný „success" ukázal
        // „Nothing found" místo chybové hlášky jako u jednotlivých databází).
        if (rv.status === 'rejected' && en.status === 'rejected') {
          throw rv.reason instanceof Error ? rv.reason : new Error(String(rv.reason))
        }
        const rvSongs = rv.status === 'fulfilled' ? rv.value.songs : []
        const enSongs = en.status === 'fulfilled' ? en.value.songs : []
        const seen = new Set<string>()
        const merged: SongResult[] = []
        const key = (s: SongResult): string =>
          `${s.artist.trim().toLowerCase()}|${s.title.trim().toLowerCase()}|${(
            s.charter ?? ''
          )
            .trim()
            .toLowerCase()}`
        // Enchor preferujeme – přímý .sng hosting bývá spolehlivější než GDrive scrape.
        for (const s of [...enSongs, ...rvSongs]) {
          const k = key(s)
          if (seen.has(k)) continue
          seen.add(k)
          merged.push(s)
        }
        // „Both" posouvá obě DB po stránkách v ZÁKRYTU (stránka P = RV[P]+Encore[P]),
        // takže STRÁNEK je tolik, co má delší katalog — NE součet obou (ten by
        // nafoukl pager o prázdné zadní stránky a rozbil losování „Surprise me").
        // Základ stránkování = max. Ale do LABELU patří SOUČET = kolik chartů je
        // dohromady k procházení (každá stránka ukazuje obě DB), jinak by Both
        // vypadal stejně jako samotný Encore.
        const rvTotal = rv.status === 'fulfilled' ? rv.value.totalFiltered : 0
        const enTotal = en.status === 'fulfilled' ? en.value.totalFiltered : 0
        return {
          songs: merged,
          totalFiltered: Math.max(rvTotal, enTotal),
          resultCount: rvTotal + enTotal,
          page,
          records
        }
      }
      return searchRhythmverse(text, page, records, system ?? 'ch', filters, sort)
    }
  )

  // Volby filtrů pro advanced panel (žánry/dekády/roky/délky z RhythmVerse číselníku).
  ipcMain.handle(
    'search:filterOptions',
    (_e, system?: RhythmVerseSystem): Promise<FilterOptions> =>
      fetchFilterOptions(system ?? 'ch')
  )

  // 30s zvuková ukázka (poslech před stažením) — spáruje se v main procesu.
  ipcMain.handle('preview:get', (_e, artist: string, title: string) => getPreview(artist, title))

  ipcMain.handle('jobs:enqueue', (_e, song: SongResult, targetSubfolder?: string) =>
    jobManager.enqueue(song, targetSubfolder)
  )
  ipcMain.handle(
    'jobs:enqueueLocal',
    (_e, localPath: string, song: SongResult, targetSubfolder?: string) =>
      jobManager.enqueueLocal(localPath, song, targetSubfolder)
  )
  ipcMain.handle(
    'jobs:enqueueLocalBatch',
    (_e, paths: string[], targetSubfolder?: string) =>
      jobManager.enqueueLocalBatch(paths, targetSubfolder)
  )
  ipcMain.handle('jobs:getAll', () => jobManager.getAll())
  ipcMain.handle('jobs:clearFinished', () => jobManager.clearFinished())
  ipcMain.handle('library:listFolders', () => listSongFolders())
  ipcMain.handle('library:ownedKeys', () => ownedSongKeys())
  ipcMain.handle('library:ownedFolders', (_e, artist: string, title: string) =>
    ownedFolders(artist, title)
  )

  // Správce knihovny
  ipcMain.handle('lib:list', (_e, rel: string) => libList(rel))
  ipcMain.handle('lib:folderCounts', (_e, rel: string) => libFolderCounts(rel))
  ipcMain.handle('lib:createFolder', (_e, rel: string, name: string) => libCreateFolder(rel, name))
  ipcMain.handle('lib:rename', (_e, relItem: string, newName: string) =>
    libRename(relItem, newName)
  )
  ipcMain.handle('lib:trash', (_e, relItem: string) => libTrash(relItem))
  ipcMain.handle('lib:moveOut', (_e, relItems: string[], destAbsDir: string) =>
    libMoveOut(relItems, destAbsDir)
  )
  ipcMain.handle('lib:move', (_e, src: string, destDir: string) => libMove(src, destDir))
  ipcMain.handle('lib:copy', (_e, src: string, destDir: string) => libCopy(src, destDir))
  ipcMain.on('lib:open', (_e, rel: string) => libOpen(rel))
  ipcMain.on('lib:reveal', (_e, relItem: string) => libReveal(relItem))
  ipcMain.handle('lib:readMeta', (_e, relItem: string) => libReadMeta(relItem))
  ipcMain.handle('lib:writeMeta', (_e, relItem: string, fields: SongMeta) =>
    libWriteMeta(relItem, fields)
  )
  ipcMain.handle('lib:songInfo', (_e, rels: string[]) => libSongInfo(rels))
  ipcMain.handle('lib:songDetail', (_e, rel: string) => libSongDetail(rel))
  ipcMain.handle('lib:findDuplicates', (_e, scope?: string[]) =>
    libFindDuplicates(Array.isArray(scope) ? scope : undefined)
  )
  ipcMain.handle('lib:listPlaylists', () => libListPlaylists())
  ipcMain.handle('lib:addToPlaylist', (_e, name: string, relItems: string[]) =>
    libAddToPlaylist(name, relItems)
  )
  ipcMain.handle('lib:deletePlaylist', (_e, name: string) => libDeletePlaylist(name))
  ipcMain.handle('lib:renamePlaylist', (_e, oldName: string, newName: string) =>
    libRenamePlaylist(oldName, newName)
  )
  ipcMain.handle('lib:playlistSongs', (_e, name: string) => libPlaylistSongs(name))
  ipcMain.handle('lib:removeFromPlaylist', (_e, name: string, hashes: string[]) =>
    libRemoveFromPlaylist(name, hashes)
  )

  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:songsDirExists', () => existsSync(getConfig().songsDir))
  ipcMain.handle('config:set', (_e, patch) => {
    const prevSongsDir = getConfig().songsDir
    const next = setConfig(patch)
    registerHotkeys() // hotkeys se mohly změnit
    applyUiScale(next.uiScale) // sjednoť zoom s uloženou hodnotou
    if (next.songsDir !== prevSongsDir) {
      // Jiná knihovna → starý index i „už mám" cache neplatí (jinak by se
      // relativní cesty odhalovaly proti novému kořenu = špatná složka).
      invalidateLibraryIndex()
      invalidateOwnedIndex()
    }
    return next
  })
  // Živý náhled UI scale (bez zápisu na disk) — Nastavení volá při posouvání.
  ipcMain.handle('ui:scale', (_e, scale: number) => applyUiScale(scale))

  ipcMain.handle('dialog:chooseDir', async (_e, defaultPath?: string) => {
    const win = getOverlay() ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ['openDirectory'],
      // Předvyplň naposledy použitou složku (např. karanténa duplicit).
      ...(defaultPath && existsSync(defaultPath) ? { defaultPath } : {})
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:chooseSongFile', async () => {
    const win = getOverlay() ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Select a chart file to install',
      properties: ['openFile'],
      filters: [
        {
          name: 'Charts & archives',
          extensions: ['zip', 'rar', '7z', 'sng', 'rb3con', 'con']
        },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    const name = path.split(/[\\/]/).pop() || path
    return { path, name }
  })

  ipcMain.handle('game:running', () => runningGame())
  ipcMain.handle('game:bringToFront', (_e, prefer?: 'clone-hero' | 'yarg') =>
    bringGameToFront(prefer)
  )
  ipcMain.handle('game:chExeStatus', () => chExeStatus())
  ipcMain.handle('game:yargExeStatus', () => yargExeStatus())

  ipcMain.handle('dialog:chooseExe', async () => {
    const win = getOverlay() ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Select Clone Hero.exe',
      properties: ['openFile'],
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle('file:peekMeta', (_e, path: string) => peekFileMeta(path))

  // Rozbalí bit.ly/tinyurl/… shortlink na finální URL — slouží jen pro UI label
  // (renderer pak rozpozná, jestli míří na MEGA / Mediafire / …).
  ipcMain.handle('url:resolve', async (_e, url: string): Promise<string> => {
    try {
      const { expandShortlink } = await import('./core/download')
      return expandShortlink(url)
    } catch {
      return url
    }
  })

  // Import playlistu (v1: veřejný Spotify přes embed, bez API klíče).
  ipcMain.handle('playlist:resolve', (_e, url: string) => resolveSpotifyPlaylist(url))

  ipcMain.on('overlay:hide', () => hideOverlay())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('hotkeys:pause', () => unregisterHotkeys())
  ipcMain.on('hotkeys:resume', () => registerHotkeys())
  ipcMain.on('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:releaseNotes', (_e, version?: string) => getReleaseNotes(version))
  ipcMain.handle('app:releaseNotesSince', (_e, since?: string, max?: number) =>
    getReleaseNotesSince(since, max)
  )

  // Přeposílání průběhu úloh do renderer procesu.
  jobManager.on('update', (job) => {
    getOverlay()?.webContents.send('jobs:update', job)
  })

  // Polling stavu her — vysílá změny rendereru + řídí reminder pill.
  // Status je teď 'clone-hero' | 'yarg' | null — pill se zobrazí pro JAKOUKOLI hru.
  let lastRunning: string | null | 'init' = 'init'
  // Zábrana překryvu: `runningGame()` spouští až dvě `tasklist` volání (timeout
  // 2,5 s každé). Když je systém zatížený a jeden poll trvá déle než 3 s interval,
  // bez tohohle by se `tasklist` procesy stohovaly. Necháme běžet jen jeden poll.
  let pollInFlight = false
  const pollGame = async (): Promise<void> => {
    if (pollInFlight) return
    pollInFlight = true
    try {
      await pollGameInner()
    } finally {
      pollInFlight = false
    }
  }
  const pollGameInner = async (): Promise<void> => {
    const running = await runningGame()
    if (running !== lastRunning) {
      const wasNone = lastRunning === null || lastRunning === 'init'
      const isNow = running !== null
      lastRunning = running
      getOverlay()?.webContents.send('game:status', running)

      if (isNow && wasNone) {
        // Hra se právě spustila → reminder pill (pokud opt-in a okno neni v popředí).
        const main = getOverlay()
        if (!main || !main.isVisible() || !main.isFocused()) {
          showReminder()
        }
      } else if (!isNow && !wasNone) {
        // Žádná hra už neběží → skrýt pill.
        hideReminder()
      }
    }
  }
  void pollGame()
  if (gamePollHandle) clearInterval(gamePollHandle)
  gamePollHandle = setInterval(pollGame, 3000)
}

/** Zastaví periodické dotazování na běžící hru (volá se při quitu). */
export function stopGamePoll(): void {
  if (gamePollHandle) {
    clearInterval(gamePollHandle)
    gamePollHandle = null
  }
}
