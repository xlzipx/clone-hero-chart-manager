// Preload: bezpečné vystavení API do renderer procesu přes contextBridge.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppConfig,
  Database,
  DownloadJob,
  DupGroup,
  LibListing,
  PlaylistAddResult,
  PlaylistInfo,
  ReleaseNotes,
  RhythmVerseSystem,
  SearchResponse,
  SongMeta,
  SongResult,
  UpdateAvailable,
  UpdateCheckResult
} from '../shared/types'

const api = {
  search: (
    text: string,
    page: number,
    records: number,
    system?: RhythmVerseSystem,
    database?: Database
  ) =>
    ipcRenderer.invoke('search', text, page, records, system, database) as Promise<SearchResponse>,

  enqueueDownload: (song: SongResult, targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueue', song, targetSubfolder) as Promise<string>,

  enqueueLocalFile: (localPath: string, song: SongResult, targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueueLocal', localPath, song, targetSubfolder) as Promise<string>,

  enqueueLocalBatch: (paths: string[], targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueueLocalBatch', paths, targetSubfolder) as Promise<string[]>,

  listSongFolders: () => ipcRenderer.invoke('library:listFolders') as Promise<string[]>,
  ownedSongKeys: () => ipcRenderer.invoke('library:ownedKeys') as Promise<string[]>,

  libList: (rel: string) => ipcRenderer.invoke('lib:list', rel) as Promise<LibListing>,
  libCreateFolder: (rel: string, name: string) =>
    ipcRenderer.invoke('lib:createFolder', rel, name) as Promise<void>,
  libRename: (relItem: string, newName: string) =>
    ipcRenderer.invoke('lib:rename', relItem, newName) as Promise<void>,
  libTrash: (relItem: string) => ipcRenderer.invoke('lib:trash', relItem) as Promise<void>,
  libMove: (src: string, destDir: string) =>
    ipcRenderer.invoke('lib:move', src, destDir) as Promise<void>,
  libCopy: (src: string, destDir: string) =>
    ipcRenderer.invoke('lib:copy', src, destDir) as Promise<void>,
  libOpen: (rel: string) => ipcRenderer.send('lib:open', rel),
  libReveal: (relItem: string) => ipcRenderer.send('lib:reveal', relItem),
  libReadMeta: (relItem: string) =>
    ipcRenderer.invoke('lib:readMeta', relItem) as Promise<SongMeta>,
  libWriteMeta: (relItem: string, fields: SongMeta) =>
    ipcRenderer.invoke('lib:writeMeta', relItem, fields) as Promise<void>,
  libFindDuplicates: () => ipcRenderer.invoke('lib:findDuplicates') as Promise<DupGroup[]>,
  libListPlaylists: () => ipcRenderer.invoke('lib:listPlaylists') as Promise<PlaylistInfo[]>,
  libAddToPlaylist: (name: string, relItems: string[]) =>
    ipcRenderer.invoke('lib:addToPlaylist', name, relItems) as Promise<PlaylistAddResult>,
  libDeletePlaylist: (name: string) =>
    ipcRenderer.invoke('lib:deletePlaylist', name) as Promise<void>,

  getJobs: () => ipcRenderer.invoke('jobs:getAll') as Promise<DownloadJob[]>,
  clearFinishedJobs: () => ipcRenderer.invoke('jobs:clearFinished') as Promise<void>,

  onJobUpdate: (cb: (job: DownloadJob) => void) => {
    const handler = (_e: unknown, job: DownloadJob) => cb(job)
    ipcRenderer.on('jobs:update', handler)
    return () => ipcRenderer.removeListener('jobs:update', handler)
  },

  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  setConfig: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke('config:set', patch) as Promise<AppConfig>,
  songsDirExists: () => ipcRenderer.invoke('config:songsDirExists') as Promise<boolean>,

  chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDir') as Promise<string | null>,
  /** Vrátí absolutní cestu k souboru přetaženému přes HTML5 drag-and-drop.
   *  V novém Electronu už `File.path` neexistuje (security) — místo toho
   *  `webUtils.getPathForFile()` v preloadu. */
  getDroppedFilePath: (file: File): string | null => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  chooseSongFile: () =>
    ipcRenderer.invoke('dialog:chooseSongFile') as Promise<
      { path: string; name: string } | null
    >,

  peekFileMeta: (path: string) =>
    ipcRenderer.invoke('file:peekMeta', path) as Promise<{
      artist: string
      title: string
    } | null>,

  /** Rozbalí shortlink na finální URL. */
  resolveUrl: (url: string) => ipcRenderer.invoke('url:resolve', url) as Promise<string>,

  runningGame: () =>
    ipcRenderer.invoke('game:running') as Promise<'clone-hero' | 'yarg' | null>,
  bringGameToFront: (prefer?: 'clone-hero' | 'yarg') =>
    ipcRenderer.invoke('game:bringToFront', prefer) as Promise<
      { ok: true; game?: 'clone-hero' | 'yarg' } | { ok: false; error: string }
    >,
  chExeStatus: () =>
    ipcRenderer.invoke('game:chExeStatus') as Promise<{
      path: string | null
      autoDetected: boolean
    }>,
  yargExeStatus: () =>
    ipcRenderer.invoke('game:yargExeStatus') as Promise<{
      path: string | null
      autoDetected: boolean
    }>,
  chooseExeFile: () => ipcRenderer.invoke('dialog:chooseExe') as Promise<string | null>,
  onGameStatus: (cb: (game: 'clone-hero' | 'yarg' | null) => void) => {
    const handler = (_e: unknown, game: 'clone-hero' | 'yarg' | null): void => cb(game)
    ipcRenderer.on('game:status', handler)
    return () => ipcRenderer.removeListener('game:status', handler)
  },

  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  quitApp: () => ipcRenderer.send('app:quit'),
  pauseHotkeys: () => ipcRenderer.send('hotkeys:pause'),
  resumeHotkeys: () => ipcRenderer.send('hotkeys:resume'),

  onHotkey: (cb: (action: string) => void) => {
    const handler = (_e: unknown, action: string) => cb(action)
    ipcRenderer.on('hotkey', handler)
    return () => ipcRenderer.removeListener('hotkey', handler)
  },

  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),

  // ---- Auto-update ----
  downloadUpdate: () =>
    ipcRenderer.invoke('update:download') as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb: (info: UpdateAvailable) => void) => {
    const handler = (_e: unknown, info: UpdateAvailable): void => cb(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateProgress: (cb: (p: { percent: number }) => void) => {
    const handler = (_e: unknown, p: { percent: number }): void => cb(p)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
    const handler = (_e: unknown, info: { version: string }): void => cb(info)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },

  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke('update:check') as Promise<UpdateCheckResult>,
  setUiScale: (scale: number) => ipcRenderer.invoke('ui:scale', scale) as Promise<void>,
  getReleaseNotes: (version?: string) =>
    ipcRenderer.invoke('app:releaseNotes', version) as Promise<ReleaseNotes | null>,
  getReleaseNotesSince: (since?: string, max?: number) =>
    ipcRenderer.invoke('app:releaseNotesSince', since, max) as Promise<ReleaseNotes[]>
}

contextBridge.exposeInMainWorld('api', api)
