// Preload: bezpečné vystavení API do renderer procesu přes contextBridge.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppConfig,
  Database,
  DownloadJob,
  DupGroup,
  FilterOptions,
  LibListing,
  LibSongInfo,
  PlaylistAddResult,
  PlaylistInfo,
  PlaylistResolveResult,
  PlaylistSong,
  PreviewResult,
  ReleaseNotes,
  RhythmVerseSystem,
  SearchFilters,
  SearchResponse,
  SongDetail,
  SongMeta,
  SongResult,
  SortKey,
  SortDir,
  UpdateAvailable,
  UpdateCheckResult
} from '../shared/types'

const api = {
  search: (
    text: string,
    page: number,
    records: number,
    system?: RhythmVerseSystem,
    database?: Database,
    filters?: SearchFilters,
    sort?: SortKey,
    sortDir?: SortDir
  ) =>
    ipcRenderer.invoke(
      'search',
      text,
      page,
      records,
      system,
      database,
      filters,
      sort,
      sortDir
    ) as Promise<SearchResponse>,
  getFilterOptions: (system?: RhythmVerseSystem) =>
    ipcRenderer.invoke('search:filterOptions', system) as Promise<FilterOptions>,

  /** Načte skladby z odkazu na playlist (v1: veřejný Spotify přes embed). */
  resolvePlaylist: (url: string) =>
    ipcRenderer.invoke('playlist:resolve', url) as Promise<PlaylistResolveResult>,

  enqueueDownload: (song: SongResult, targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueue', song, targetSubfolder) as Promise<string>,

  enqueueLocalFile: (localPath: string, song: SongResult, targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueueLocal', localPath, song, targetSubfolder) as Promise<string>,

  enqueueLocalBatch: (paths: string[], targetSubfolder?: string) =>
    ipcRenderer.invoke('jobs:enqueueLocalBatch', paths, targetSubfolder) as Promise<string[]>,

  listSongFolders: () => ipcRenderer.invoke('library:listFolders') as Promise<string[]>,
  ownedSongKeys: () => ipcRenderer.invoke('library:ownedKeys') as Promise<string[]>,
  /** Relativní cesty (k Songs) položek knihovny odpovídajících písni (duplikáty = víc). */
  ownedFolders: (artist: string, title: string) =>
    ipcRenderer.invoke('library:ownedFolders', artist, title) as Promise<string[]>,

  libList: (rel: string) => ipcRenderer.invoke('lib:list', rel) as Promise<LibListing>,
  libFolderCounts: (rel: string) =>
    ipcRenderer.invoke('lib:folderCounts', rel) as Promise<Record<string, number>>,
  libCreateFolder: (rel: string, name: string) =>
    ipcRenderer.invoke('lib:createFolder', rel, name) as Promise<void>,
  libRename: (relItem: string, newName: string) =>
    ipcRenderer.invoke('lib:rename', relItem, newName) as Promise<void>,
  libTrash: (relItem: string) => ipcRenderer.invoke('lib:trash', relItem) as Promise<void>,
  libMoveOut: (relItems: string[], destAbsDir: string) =>
    ipcRenderer.invoke('lib:moveOut', relItems, destAbsDir) as Promise<void>,
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
  libSongInfo: (rels: string[]) =>
    ipcRenderer.invoke('lib:songInfo', rels) as Promise<LibSongInfo[]>,
  libSongDetail: (rel: string) =>
    ipcRenderer.invoke('lib:songDetail', rel) as Promise<SongDetail>,
  libFindDuplicates: (scope?: string[]) =>
    ipcRenderer.invoke('lib:findDuplicates', scope) as Promise<DupGroup[]>,
  libListPlaylists: () => ipcRenderer.invoke('lib:listPlaylists') as Promise<PlaylistInfo[]>,
  libAddToPlaylist: (name: string, relItems: string[]) =>
    ipcRenderer.invoke('lib:addToPlaylist', name, relItems) as Promise<PlaylistAddResult>,
  libDeletePlaylist: (name: string) =>
    ipcRenderer.invoke('lib:deletePlaylist', name) as Promise<void>,
  libRenamePlaylist: (oldName: string, newName: string) =>
    ipcRenderer.invoke('lib:renamePlaylist', oldName, newName) as Promise<void>,
  libPlaylistSongs: (name: string) =>
    ipcRenderer.invoke('lib:playlistSongs', name) as Promise<PlaylistSong[]>,
  libRemoveFromPlaylist: (name: string, hashes: string[]) =>
    ipcRenderer.invoke('lib:removeFromPlaylist', name, hashes) as Promise<void>,

  getJobs: () => ipcRenderer.invoke('jobs:getAll') as Promise<DownloadJob[]>,
  clearFinishedJobs: () => ipcRenderer.invoke('jobs:clearFinished') as Promise<void>,
  cancelJob: (id: string) => ipcRenderer.invoke('jobs:cancel', id) as Promise<void>,
  cancelAllJobs: () => ipcRenderer.invoke('jobs:cancelAll') as Promise<void>,

  onJobUpdate: (cb: (job: DownloadJob) => void) => {
    const handler = (_e: unknown, job: DownloadJob) => cb(job)
    ipcRenderer.on('jobs:update', handler)
    return () => ipcRenderer.removeListener('jobs:update', handler)
  },

  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  setConfig: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke('config:set', patch) as Promise<AppConfig>,
  songsDirExists: () => ipcRenderer.invoke('config:songsDirExists') as Promise<boolean>,

  chooseDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke('dialog:chooseDir', defaultPath) as Promise<string | null>,
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

  /** 30s zvuková ukázka spárovaná podle interpreta + názvu. */
  preview: (artist: string, title: string) =>
    ipcRenderer.invoke('preview:get', artist, title) as Promise<PreviewResult>,

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
  toggleMaximize: () => ipcRenderer.send('overlay:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('overlay:isMaximized') as Promise<boolean>,
  onMaximizeChange: (cb: (max: boolean) => void) => {
    const handler = (_e: unknown, max: boolean) => cb(max)
    ipcRenderer.on('overlay:maximized', handler)
    return () => ipcRenderer.removeListener('overlay:maximized', handler)
  },
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
