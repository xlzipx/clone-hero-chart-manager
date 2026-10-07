import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ExtraFolderInfo, InstrumentDifficulties, LibEntry, LibListing, LibProblem, LibSongInfo, SongDetail } from '../../../shared/types'
import { userMsg } from '../../../shared/errors'
import { IS_MAC } from '../platform'
import { useStore } from '../store'
import { formatLength, INSTRUMENTS, stripTags } from '../utils'
import { songFromFolderName } from '../chartmatch'
import { RichText } from './RichText'
import { LocalPreview } from './LocalPreview'
import { DuplicatesView } from './DuplicatesView'
import { Icon, type IconName } from './Icon'
import { InstrumentDifficulty } from './InstrumentDifficulty'
import { PlaylistDialog } from './PlaylistDialog'
import { SetlistsView } from './SetlistsView'
import { SongMetaDialog } from './SongMetaDialog'
import { BulkRenameDialog, FolderPickerDialog, useExistingCheck, type BulkItem } from './LibraryDialogs'
import { isTypingTarget } from '../rangeToggle'
import { LEVELS, LevelsBadge, type Level } from './LevelsBadge'
import { artistWords } from '../../../shared/songid'

/** broken = složka s audiem, ale bez souboru s notami (Clone Hero ji nenačte). */
type Kind = 'folder' | 'song' | 'broken' | 'file'
interface Item {
  e: LibEntry
  /** Klíč položky v aktuální složce; u rozbitých z podsložek cesta „Pack/Píseň“. */
  name: string
  /** Zobrazovaný název (poslední část cesty). */
  label: string
  /** Podsložka, ve které položka leží (jen rozbité písně z hlubších úrovní). */
  dir?: string
  rel: string
  kind: Kind
  /** Volné .sng (soubor s celým chartem). */
  isSng: boolean
}

type InstId = keyof InstrumentDifficulties
type SortKey =
  | 'name'
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'length'
  | 'charter'
  | 'songs'
  | 'modified'
  | 'created'
  | 'dmax'
  | `d:${InstId}`

const SORTS: { id: SortKey; label: string; group: 'Song' | 'Intensity' | 'File' }[] = [
  { id: 'name', label: 'Folder name', group: 'File' },
  { id: 'modified', label: 'Date modified', group: 'File' },
  { id: 'created', label: 'Date added', group: 'File' },
  { id: 'songs', label: 'Songs inside', group: 'File' },
  { id: 'title', label: 'Title', group: 'Song' },
  { id: 'artist', label: 'Artist', group: 'Song' },
  { id: 'album', label: 'Album', group: 'Song' },
  { id: 'year', label: 'Year', group: 'Song' },
  { id: 'length', label: 'Length', group: 'Song' },
  { id: 'charter', label: 'Charter', group: 'Song' },
  ...INSTRUMENTS.map((i) => ({ id: `d:${i.id}` as SortKey, label: `${i.label} intensity`, group: 'Intensity' as const })),
  { id: 'dmax', label: 'Most intense instrument', group: 'Intensity' }
]
// Čísla (rok, délka, obtížnost, data) se řadí od nejvyšší hodnoty, texty od A.
const DESC_FIRST = new Set<SortKey>(['year', 'length', 'songs', 'modified', 'created', 'dmax', ...INSTRUMENTS.map((i) => `d:${i.id}` as SortKey)])

interface Filters {
  inst: InstId[]
  min: number
  max: number
  charter: string
  /** Interpret / album (jako ve vyhledávání). Hledá v celé větvi pod složkou. */
  artist: string
  album: string
  /** Obsažené obtížnosti: píseň musí mít všechny vybrané. */
  levels: Level[]
  /** Jen charty bez nižších obtížností (jen Expert). */
  expertOnly: boolean
  /** Jen složky, kterým chybí soubor s notami. */
  broken: boolean
}
const NO_FILTERS: Filters = { inst: [], min: 0, max: 6, charter: '', artist: '', album: '', levels: [], expertOnly: false, broken: false }


type Dialog =
  | { type: 'new' }
  | { type: 'rename'; name: string; base?: string }
  | { type: 'delete'; names: string[]; base?: string }
  | { type: 'bulkRename'; names: string[] }
  | { type: 'pick'; mode: 'move' | 'copy'; names: string[]; base?: string }
  | null
type Clip = { op: 'cut' | 'copy'; items: string[]; names: string[] } | null
/** `side` = menu pro složku z levého panelu (název v kořeni Songs). */
type Ctx = { x: number; y: number; side?: string; ext?: string } | null

// Mezi přepnutími Search ↔ Library si pamatujeme otevřenou složku a náhledy.
/** Sdílený porovnávač názvů (přirozené řazení čísel, bez ohledu na velikost). */
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
let lastCwd = ''
let lastExtFolders: ExtraFolderInfo[] = []
/** Výška karty v pohledu Cards (pevná, viz .lv__list--cards > .lvcard v CSS);
 *  s nastavením „Compact rows" nižší, stejně jako řádky hledání. */
const CARD_ROW = 98
const CARD_ROW_COMPACT = 60
/** Od kolika položek se karty virtualizují, a kolik karet navíc nad/pod výřezem. */
const VIRT_MIN = 120
const VIRT_OVERSCAN = 8
/** Otevřený nástroj knihovny (Setlists / Duplicates) — přežije přepnutí do hledání. */
let lastTool: 'setlists' | 'duplicates' | null = null
// Hledání a filtry drží jen po dobu běhu appky (po restartu začínají čisté,
// aby uživatel nehledal, proč mu v knihovně chybí písně).
let lastQ = ''
let lastFilters: Filters = NO_FILTERS
let lastFiltersOpen = false
const thumbCache = new Map<string, string | null>()
/** Obaly do koláže složky v pravém panelu (rel složky → až 4 různé obaly). */
const folderCoverCache = new Map<string, string[]>()
// Poslední stav otevřené složky (seznam, metadata, počty, strom, scroll). Po návratu
// do Library se hned vykreslí a jen se na pozadí obnoví — bez probliknutí holých
// názvů složek, než se znovu načtou song.ini.
type Snap = {
  path: string
  entries: LibEntry[]
  infos: Record<string, LibSongInfo>
  folderCounts: Record<string, number>
  scroll: number
}
let snap: Snap | null = null
let snapRootDirs: LibEntry[] = []
let snapRootCounts: Record<string, number> = {}
const folderCountsCache = new Map<string, Record<string, number>>()
/** Rozbité písně pod složkou (rekurzivně) — filtr „Broken songs“. */
const brokenCache = new Map<string, LibEntry[]>()
/** Metadata písní podle složky — přepínání mezi složkami bez probliknutí. */
const infosCache = new Map<string, Record<string, LibSongInfo>>()
/** Obsažené obtížnosti písní (rel → „emhx"), přes celou dobu běhu. */
const levelsCache = new Map<string, string>()
/** Metadata všech už načtených písní (rel → info). Filtr přes celou větev pak
 *  dočítá jen to, co ještě nezná, místo celé knihovny při každém zapnutí. */
const allInfos = new Map<string, LibSongInfo>()
/** Po změně souborů zvenku (tlačítko Obnovit) zapomeň vše načtené. */
function forgetSongData(): void {
  allInfos.clear()
  levelsCache.clear()
  songsDeepCache.clear()
}
/** Všechny písně větve (filtr interpreta / alba), klíč = složka. */
const songsDeepCache = new Map<string, LibEntry[]>()

/** Metadata volného .sng odhadnutá z názvu souboru („Artist - Title.sng"). */
function sngInfo(rel: string, name: string): LibSongInfo {
  const base = name.replace(/\.sng$/i, '')
  const dash = base.indexOf(' - ')
  return {
    rel,
    title: dash > 0 ? base.slice(dash + 3) : base,
    artist: dash > 0 ? base.slice(0, dash) : '',
    charter: '',
    album: '',
    genre: '',
    year: null,
    lengthSeconds: null,
    difficulties: {}
  }
}

function hardest(d: InstrumentDifficulties | undefined): number | undefined {
  if (!d) return undefined
  let m: number | undefined
  for (const i of INSTRUMENTS) {
    const v = d[i.id]
    if (v !== undefined && (m === undefined || v > m)) m = v
  }
  return m
}

export function LibraryView(): JSX.Element {
  const playFolder = useStore((s) => s.playFolder)
  const libraryReveal = useStore((s) => s.libraryReveal)
  const config = useStore((s) => s.config)
  const saveConfig = useStore((s) => s.saveConfig)
  const playFolders = useStore((s) => s.playFolders)
  const openBulkFix = useStore((s) => s.openBulkFix)
  const bulkRun = useStore((s) => s.bulkRun)
  const dismissBulkRun = useStore((s) => s.dismissBulkRun)

  const [cwd, setCwd] = useState(lastCwd)
  const initSnap = snap && snap.path === lastCwd ? snap : null
  const [entries, setEntries] = useState<LibEntry[]>(() => initSnap?.entries ?? [])
  // Rozbité písně v aktuální složce I všech podsložkách (načítá se na pozadí).
  const [brokenDeep, setBrokenDeep] = useState<{ path: string; entries: LibEntry[] } | null>(() => {
    const hit = brokenCache.get(lastCwd)
    return hit ? { path: lastCwd, entries: hit } : null
  })
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>(() => initSnap?.folderCounts ?? {})
  const [infos, setInfos] = useState<Record<string, LibSongInfo>>(() => initSnap?.infos ?? {})
  const [infoLoading, setInfoLoading] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>(() => Object.fromEntries(thumbCache))
  const [rootDirs, setRootDirs] = useState<LibEntry[]>(snapRootDirs)
  // Další složky s charty mimo Songs (issue #8). Cesty v nich: `::id/…`.
  const [extFolders, setExtFolders] = useState<ExtraFolderInfo[]>(lastExtFolders)
  const [rootCounts, setRootCounts] = useState<Record<string, number>>(snapRootCounts)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'cards' | 'list'>(config?.libraryView ?? 'cards')
  const cardRow = useStore((s) => s.config?.compactRows) ? CARD_ROW_COMPACT : CARD_ROW
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const k = config?.librarySort?.key
    return SORTS.some((s) => s.id === k) ? (k as SortKey) : 'name'
  })
  const [sortDir, setSortDir] = useState<1 | -1>(() => (config?.librarySort?.dir === -1 ? -1 : 1))
  const [q, setQ] = useState(lastQ)
  const [filters, setFilters] = useState<Filters>(lastFilters)
  const [filtersOpen, setFiltersOpen] = useState(lastFiltersOpen)
  const [levels, setLevels] = useState<Record<string, string>>(() => Object.fromEntries(levelsCache))
  const [levelsLoading, setLevelsLoading] = useState(false)
  const [songsDeep, setSongsDeep] = useState<{ path: string; entries: LibEntry[] } | null>(null)

  const [focus, setFocus] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [clip, setClip] = useState<Clip>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [ctx, setCtx] = useState<Ctx>(null)
  const [metaFor, setMetaFor] = useState<{ rel: string; title: string } | null>(null)
  const [playlistFor, setPlaylistFor] = useState<string[] | null>(null)
  // Setlisty a duplicity jsou obrazovky knihovny (dřív modální okna).
  const [tool, setToolState] = useState<'setlists' | 'duplicates' | null>(lastTool)
  const setTool = (t: 'setlists' | 'duplicates' | null): void => {
    lastTool = t
    setToolState(t)
  }
  const [detail, setDetail] = useState<SongDetail | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [revealActive, setRevealActive] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  // Virtualizace karet: u velkých složek se vykreslí jen karty ve výřezu (+ rezerva).
  // Tisíce karet s obaly by jinak brzdily každý snímek scrollu (layout, styly,
  // hlídání viditelnosti). Karty mají pevnou výšku (cardRow), takže rozsah jde
  // spočítat přímo ze scrollTop.
  const [vScroll, setVScroll] = useState(0)
  const [vHeight, setVHeight] = useState(900)
  const vRaf = useRef(0)
  const visibleRef = useRef<Item[]>([])
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // Výška se mění i během animací (vysouvání filtrů) — překreslovat celou
    // knihovnu v každém snímku by animaci sekalo. Stačí hodnota po doběhnutí;
    // rezerva karet (VIRT_OVERSCAN) mezitím pokryje případné zvětšení.
    let t = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(() => setVHeight(el.clientHeight), 120)
    })
    ro.observe(el)
    setVHeight(el.clientHeight)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
    }
  }, [])
  const ctxRef = useRef<HTMLDivElement>(null)
  const crumbsRef = useRef<HTMLDivElement>(null)
  // Dlouhá cesta: drž na očích konec (aktuální složku), ne kořen.
  useLayoutEffect(() => {
    const el = crumbsRef.current
    if (!el) return
    // Posouvej jen při skutečném přetečení; o pár px by jen usekl ikonu na začátku.
    el.scrollLeft = el.scrollWidth - el.clientWidth > 24 ? el.scrollWidth : 0
  }, [cwd])
  const loadSeq = useRef(0)
  const countsCache = useRef(folderCountsCache)
  // Pro kterou složku drží `infos` data — při obnovení téže složky se staré
  // metadata nezahazují (jinak by karty na chvíli spadly na holé názvy).
  const infosPath = useRef<string | null>(initSnap ? initSnap.path : null)

  useEffect(() => {
    snap = { path: cwd, entries, infos, folderCounts, scroll: snap?.path === cwd ? snap.scroll : 0 }
    if (infosPath.current === cwd) infosCache.set(cwd, infos)
  }, [cwd, entries, infos, folderCounts])
  useEffect(() => {
    snapRootDirs = rootDirs
    snapRootCounts = rootCounts
  }, [rootDirs, rootCounts])
  // Obnov scroll po návratu (před prvním vykreslením, ať neposkočí).
  useLayoutEffect(() => {
    if (initSnap && listRef.current) listRef.current.scrollTop = initSnap.scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hromadná oprava: po každé nahrazené složce obnov výpis (rozbitá zmizí).
  const fixedCount = bulkRun ? bulkRun.ok + bulkRun.failed : 0
  useEffect(() => {
    if (!bulkRun || fixedCount === 0) return
    brokenCache.clear()
    void load(cwd, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedCount])

  const relOf = useCallback((name: string): string => (cwd ? `${cwd}/${name}` : name), [cwd])
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  const anyDialog = dialog !== null || metaFor !== null || playlistFor !== null || tool !== null

  // ── Načtení složky ────────────────────────────────────────────────
  // Metadata písní (song.ini) pro seznam složky; .sng mají jen odhad z názvu.
  const songRels = (path: string, list: LibEntry[]): string[] =>
    list.filter((e) => e.type === 'dir' && e.isSong).map((e) => (path ? `${path}/${e.name}` : e.name))
  const sngBase = (path: string, list: LibEntry[]): Record<string, LibSongInfo> => {
    const base: Record<string, LibSongInfo> = {}
    for (const s of list) {
      if (s.type !== 'file' || !/\.sng$/i.test(s.name)) continue
      const rel = path ? `${path}/${s.name}` : s.name
      base[rel] = sngInfo(rel, s.name)
    }
    return base
  }
  const fetchInfos = async (rels: string[]): Promise<LibSongInfo[]> => {
    try {
      return await window.api.libSongInfo(rels)
    } catch {
      return [] /* chybějící metadata = karta jen s názvem složky */
    }
  }

  // Zbytek metadat po dávkách (první dávku načte už `load`, ať karty neprobliknou
  // holými názvy). Bez nich by nešlo řadit ani filtrovat podle obtížnosti.
  // Obsažené obtížnosti se čtou ze souborů s notami (main si je pamatuje podle
  // změny souboru), proto až po metadatech, ať karty nečekají.
  const loadLevels = async (rels: string[], my: number): Promise<void> => {
    const todo = rels.filter((r) => !/\.sng$/i.test(r) && !levelsCache.has(r))
    if (!todo.length) return
    setLevelsLoading(true)
    try {
      for (let i = 0; i < todo.length; i += 200) {
        const got = await window.api.libSongLevels(todo.slice(i, i + 200))
        if (my !== loadSeq.current) return
        for (const [r, v] of Object.entries(got)) levelsCache.set(r, v)
        setLevels((prev) => ({ ...prev, ...got }))
      }
    } catch {
      /* bez údaje = bez odznaku */
    } finally {
      if (my === loadSeq.current) setLevelsLoading(false)
    }
  }

  const loadInfos = async (rels: string[], from: number, my: number): Promise<void> => {
    if (from >= rels.length) {
      setInfoLoading(false)
      void loadLevels(rels, my)
      return
    }
    setInfoLoading(true)
    // Výsledky se do stavu propisují nejvýš ~3× za vteřinu, ne po každé dávce:
    // každá změna `infos` znamená nové seřazení a překreslení celé složky, což
    // u tisíců písní dělalo scrollování během načítání trhané.
    let buf: LibSongInfo[] = []
    let lastFlush = performance.now()
    const flush = (): void => {
      if (!buf.length) return
      const got = buf
      buf = []
      lastFlush = performance.now()
      for (const g of got) allInfos.set(g.rel, g)
      setInfos((prev) => {
        const next = { ...prev }
        for (const g of got) next[g.rel] = g
        return next
      })
    }
    for (let i = from; i < rels.length; i += 120) {
      const got = await fetchInfos(rels.slice(i, i + 120))
      if (my !== loadSeq.current) return
      buf.push(...got)
      if (performance.now() - lastFlush > 350) flush()
    }
    flush()
    if (my === loadSeq.current) setInfoLoading(false)
    void loadLevels(rels, my)
  }

  // Rozbité písně pod složkou, včetně všech podsložek (filtr „Broken songs“).
  const scanBroken = async (path: string, my: number): Promise<void> => {
    const hit = brokenCache.get(path)
    setBrokenDeep(hit ? { path, entries: hit } : null)
    try {
      const list = await window.api.libFindBroken(path)
      brokenCache.set(path, list)
      if (my === loadSeq.current) setBrokenDeep({ path, entries: list })
    } catch {
      /* bez výsledku zůstane jen kontrola aktuální složky */
    }
  }

  const loadTree = (): void => {
    folderCoverCache.clear()
    void window.api
      .libExtraFolders()
      .then((f) => {
        lastExtFolders = f
        setExtFolders(f)
      })
      .catch(() => undefined)
    void window.api
      .libList('')
      .then((r) => setRootDirs(r.entries.filter((e) => e.type === 'dir' && !e.isSong)))
      .catch(() => setRootDirs([]))
    void window.api
      .libFolderCounts('')
      .then(setRootCounts)
      .catch(() => undefined)
  }

  const load = async (rel: string, keepSelection = false): Promise<void> => {
    const my = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.libList(rel)
      if (my !== loadSeq.current) return
      // Novou složku ukaž až s metadaty: ze známé cache hned, jinak po první dávce
      // (typicky celá viditelná část). Jinak by na okamžik blikly holé názvy složek.
      const rels = songRels(res.path, res.entries)
      const cached = infosCache.get(res.path)
      let first: LibSongInfo[] = []
      // Souběžně i obaly prvních karet (max ~0,5 s čekání), ať nenaskakují po jednom.
      const thumbRels = view === 'cards' ? rels.filter((r) => !thumbCache.has(r)).slice(0, 16) : []
      const thumbsP = thumbRels.length
        ? Promise.race([
            window.api
              .libAlbumThumbs(thumbRels)
              .then((t) => {
                for (const [r, v] of Object.entries(t)) thumbCache.set(r, v)
                // I po vypršení čekání — requestThumb je už kvůli cache znovu nevyžádá.
                setThumbs((prev) => ({ ...prev, ...t }))
                return t
              })
              .catch(() => ({})),
            new Promise<Record<string, string | null>>((r) => setTimeout(() => r({}), 500))
          ])
        : Promise.resolve({} as Record<string, string | null>)
      if (!cached && rels.length) first = await fetchInfos(rels.slice(0, 80))
      await thumbsP
      if (my !== loadSeq.current) return
      const nextInfos: Record<string, LibSongInfo> = { ...(cached ?? {}), ...sngBase(res.path, res.entries) }
      for (const g of first) {
        nextInfos[g.rel] = g
        allInfos.set(g.rel, g)
      }
      infosPath.current = res.path
      setInfos(nextInfos)
      lastCwd = res.path
      setCwd(res.path)
      setEntries(res.entries)
      if (!keepSelection) {
        setChecked(new Set())
        setFocus(null)
        setAnchor(null)
        listRef.current?.scrollTo({ top: 0 })
      }
      setFolderCounts(countsCache.current.get(res.path) ?? {})
      void window.api.libFolderCounts(res.path).then((c) => {
        countsCache.current.set(res.path, c)
        if (my === loadSeq.current) setFolderCounts(c)
      })
      void loadInfos(rels, cached ? 0 : 80, my)
      void scanBroken(res.path, my)
    } catch (e) {
      if (my !== loadSeq.current) return
      if (rel.startsWith('::')) {
        // Složka mezitím odebraná ze seznamu → zpět do Songs. Odpojený disk →
        // ukázat chybu přímo v té složce (prázdný seznam), ne v té předchozí.
        const id = rel.slice(2).split('/')[0]
        if (!lastExtFolders.some((f) => f.id === id)) {
          void load('')
          return
        }
        lastCwd = rel
        setCwd(rel)
        setEntries([])
      }
      setError(userMsg(e))
    } finally {
      if (my === loadSeq.current) setLoading(false)
    }
  }

  const revealTarget = async (rel: string): Promise<void> => {
    const parts = rel.split(/[\\/]/).filter(Boolean)
    const name = parts.pop() ?? ''
    const p = load(parts.join('/'))
    const mySeq = loadSeq.current
    await p
    if (mySeq !== loadSeq.current) return
    setRevealActive(rel)
    if (name) {
      setFocus(name)
      setTimeout(() => {
        const el = listRef.current
        const row = el?.querySelector('.lvrow--focus')
        if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        else if (el) {
          // Virtualizovaný seznam: karta ještě není v DOM → posun podle indexu.
          const idx = visibleRef.current.findIndex((i) => i.name === name)
          if (idx >= 0) el.scrollTo({ top: Math.max(0, idx * cardRow - el.clientHeight / 2 + cardRow / 2) })
        }
      }, 80)
    }
  }

  useEffect(() => {
    loadTree()
    const targets = useStore.getState().libraryReveal
    // „In library" z hledání míří na konkrétní píseň → vždy do Songs, i když
    // byl naposledy otevřený nástroj (Setlists / Duplicates).
    if (targets && targets.length) {
      setTool(null)
      void revealTarget(targets[0])
    } else void load(lastCwd, initSnap !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // „In library" z hledání, když je Library už otevřená.
  useEffect(() => {
    if (libraryReveal && libraryReveal.length) {
      setTool(null)
      void revealTarget(libraryReveal[0])
    } else setRevealActive(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReveal])

  const run = async (fn: () => Promise<void>, okMsg?: string): Promise<void> => {
    let failed: string | null = null
    try {
      setError(null)
      await fn()
      if (okMsg) showToast(okMsg)
    } catch (e) {
      failed = userMsg(e)
    }
    await load(reloadPath(), true)
    // Až po načtení: load() chybu na začátku maže, jinak by hláška hned zmizela.
    if (failed) setError(failed)
    loadTree()
  }
  /** Složka z levého panelu, kterou poslední akce přejmenovala / smazala / přesunula. */
  const sideAffect = useRef<string | null>(null)
  const reloadPath = (): string => {
    const a = sideAffect.current
    sideAffect.current = null
    return a && (cwd === a || cwd.startsWith(`${a}/`)) ? '' : cwd
  }
  const relIn = (base: string | undefined, name: string): string =>
    base === undefined ? relOf(name) : base ? `${base}/${name}` : name

  // Rozbalení .sng souborů (z výběru nebo zaostřené položky) do složek písní.
  const unpackSng = (): void => {
    const sngs = targetNames().filter((n) => /\.sng$/i.test(n))
    if (!sngs.length) return
    void run(async () => {
      for (const n of sngs) await window.api.libUnpackSng(relOf(n))
      setChecked(new Set())
      setFocus(null)
    }, `Unpacked ${sngs.length} .sng file${sngs.length === 1 ? '' : 's'} into song folders`)
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const showToast = (msg: string): void => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  // ── Položky: druh, filtr, řazení ─────────────────────────────────
  const deep = brokenDeep && brokenDeep.path === cwd ? brokenDeep.entries : null
  // Výpočet seznamu podle filtrů běží „odloženě" (React useDeferredValue): klik
  // na filtr i psaní reagují hned a seznam (u celé knihovny tisíce položek) se
  // dopočítá po nich, přerušitelně.
  const fd = useDeferredValue(filters)
  const qDeferred = useDeferredValue(q)
  // Filtry podle údajů o písni hledají v celé větvi pod složkou (jako „Broken
  // songs"), jinak by v kořeni se samými složkami nenašly nic.
  const levelFilter = fd.expertOnly || fd.levels.length > 0
  const metaFilter =
    fd.inst.length > 0 ||
    fd.min > 0 ||
    fd.max < 6 ||
    !!fd.charter.trim() ||
    !!fd.artist.trim() ||
    !!fd.album.trim() ||
    levelFilter
  const songsDeepHere = metaFilter && songsDeep && songsDeep.path === cwd ? songsDeep.entries : null
  useEffect(() => {
    if (!metaFilter) return
    const my = loadSeq.current
    const path = cwd
    const hit = songsDeepCache.get(path)
    if (hit) setSongsDeep({ path, entries: hit })
    void window.api
      .libFindSongs(path)
      .then((list) => {
        songsDeepCache.set(path, list)
        if (my !== loadSeq.current) return
        setSongsDeep({ path, entries: list })
        const rels = list.map((e) => (path ? `${path}/${e.name}` : e.name))
        const known: Record<string, LibSongInfo> = {}
        const missing: string[] = []
        for (const r of rels) {
          const k = allInfos.get(r)
          if (k) known[r] = k
          else missing.push(r)
        }
        setInfos((prev) => ({ ...known, ...prev }))
        void loadInfos(missing, 0, my)
        void loadLevels(rels, my)
      })
      .catch(() => undefined)
    // Znovu i po obnovení složky (`entries`), ať sedí po přesunu / smazání.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaFilter, cwd, entries])
  const items: Item[] = useMemo(() => {
    if (songsDeepHere && !fd.broken) {
      return songsDeepHere.map((e) => {
        const cut = e.name.lastIndexOf('/')
        return {
          e,
          name: e.name,
          label: cut >= 0 ? e.name.slice(cut + 1) : e.name,
          dir: cut >= 0 ? e.name.slice(0, cut) : undefined,
          rel: cwd ? `${cwd}/${e.name}` : e.name,
          kind: 'song' as Kind,
          isSng: false
        }
      })
    }
    // Filtr „Broken songs“ ukazuje rozbité písně z celé větve, ne jen z této složky.
    if (fd.broken && deep) {
      return deep.map((e) => {
        const cut = e.name.lastIndexOf('/')
        return {
          e,
          name: e.name,
          label: cut >= 0 ? e.name.slice(cut + 1) : e.name,
          dir: cut >= 0 ? e.name.slice(0, cut) : undefined,
          rel: cwd ? `${cwd}/${e.name}` : e.name,
          kind: 'broken' as Kind,
          isSng: false
        }
      })
    }
    return entries.map((e) => {
      const rel = cwd ? `${cwd}/${e.name}` : e.name
      const isSng = e.type === 'file' && /\.sng$/i.test(e.name)
      const kind: Kind =
        e.type === 'dir' ? (e.problem ? 'broken' : e.isSong ? 'song' : 'folder') : isSng ? 'song' : 'file'
      return { e, name: e.name, label: e.name, rel, kind, isSng }
    })
  }, [entries, cwd, fd.broken, deep, songsDeepHere])

  const activeFilterCount =
    filters.inst.length +
    (filters.min > 0 || filters.max < 6 ? 1 : 0) +
    (filters.charter.trim() ? 1 : 0) +
    (filters.artist.trim() ? 1 : 0) +
    (filters.album.trim() ? 1 : 0) +
    (levelFilter ? 1 : 0) +
    (filters.broken ? 1 : 0)
  // Všechny rozbité písně této větve (pro „Fix all").
  const brokenTargets = (): { rel: string; name: string }[] =>
    deep
      ? deep.map((e) => ({ rel: cwd ? `${cwd}/${e.name}` : e.name, name: e.name.split('/').pop() ?? e.name }))
      : items.filter((i) => i.kind === 'broken').map((i) => ({ rel: i.rel, name: i.label }))
  // Počet za celou větev (jakmile doběhne sken), jinak aspoň z této složky.
  const brokenCount = deep ? deep.length : items.filter((i) => i.kind === 'broken').length

  const visible: Item[] = useMemo(() => {
    const filters = fd
    const needle = qDeferred.trim().toLowerCase()
    const ch = filters.charter.trim().toLowerCase()
    // Jako artistMatches, jen se slova filtru normalizují jednou, ne u každé písně.
    const arWords = filters.artist.trim() ? artistWords(filters.artist) : ''
    const al = filters.album.trim().toLowerCase()
    const inRange = (v: number | undefined): boolean => v !== undefined && v >= filters.min && v <= filters.max
    const list = items.filter((it) => {
      const info = infos[it.rel]
      if (needle) {
        const hay = [it.name, info?.title, info?.artist, info?.album].filter(Boolean).map((s) => stripTags(s as string)).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (filters.broken) return it.kind === 'broken'
      if (!metaFilter) return true
      // Filtry podle metadat mají smysl jen u písní.
      if (it.kind !== 'song' || !info) return false
      if (ch && !stripTags(info.charter).toLowerCase().includes(ch)) return false
      if (arWords && !artistWords(stripTags(info.artist)).includes(arWords)) return false
      if (al && !stripTags(info.album).toLowerCase().includes(al)) return false
      if (levelFilter) {
        const lv = levels[it.rel]
        if (lv === undefined) return false // ještě nepřečteno / bez souboru s notami
        if (filters.expertOnly ? lv !== 'x' : !filters.levels.every((l) => lv.includes(l))) return false
      }
      const d = info.difficulties
      if (filters.inst.length) return filters.inst.every((id) => inRange(d[id]))
      if (filters.min > 0 || filters.max < 6) return INSTRUMENTS.some((i) => inRange(d[i.id]))
      return true
    })
    // Rozbité složky hned pod běžné složky, ať problém nezapadne mezi písněmi.
    const group = (it: Item): number =>
      it.kind === 'folder' ? 0 : it.kind === 'broken' ? 1 : it.kind === 'song' ? 2 : 3
    const val = (it: Item): string | number | undefined => {
      const info = infos[it.rel]
      switch (sortKey) {
        case 'name':
          return it.name
        case 'modified':
          return it.e.mtimeMs
        case 'created':
          return it.e.birthtimeMs
        case 'songs':
          return it.kind === 'folder' ? folderCounts[it.name] : undefined
        case 'title':
          return info ? stripTags(info.title) || it.name : it.name
        case 'artist':
          return info ? stripTags(info.artist) || undefined : undefined
        case 'album':
          return info ? stripTags(info.album) || undefined : undefined
        case 'charter':
          return info ? stripTags(info.charter) || undefined : undefined
        case 'year':
          return info?.year ?? undefined
        case 'length':
          return info?.lengthSeconds ?? undefined
        case 'dmax':
          return hardest(info?.difficulties)
        default:
          return info?.difficulties[sortKey.slice(2) as InstId]
      }
    }
    // Klíče řazení spočítat JEDNOU na položku (ne při každém porovnání) a
    // porovnávat sdíleným Collatorem — u tisíců písní je to řádově rychlejší
    // než localeCompare s volbami, které si pokaždé staví nový porovnávač.
    const keyed = list.map((it) => ({ it, g: group(it), v: val(it) }))
    keyed.sort((a, b) => {
      // Složky vždy nahoře, pak písně, pak ostatní soubory — nezávisle na směru.
      const g = a.g - b.g
      if (g) return g
      const va = a.v
      const vb = b.v
      // Chybějící hodnota (nenacharovaný nástroj, žádný rok…) vždy na konec.
      if (va === undefined && vb !== undefined) return 1
      if (vb === undefined && va !== undefined) return -1
      if (va !== undefined && vb !== undefined) {
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : NAME_COLLATOR.compare(String(va), String(vb))
        if (c) return c * sortDir
      }
      return NAME_COLLATOR.compare(a.it.name, b.it.name)
    })
    return keyed.map((k) => k.it)
  }, [items, infos, levels, levelFilter, qDeferred, fd, metaFilter, sortKey, sortDir, folderCounts])

  // Zaškrtnuté položky, které filtr schoval, z výběru vyřaď — hromadná akce se
  // nesmí dotknout něčeho, co uživatel právě nevidí.
  useEffect(() => {
    setChecked((prev) => {
      if (!prev.size) return prev
      const vis = new Set(visible.map((i) => i.name))
      const next = new Set([...prev].filter((n) => vis.has(n)))
      return next.size === prev.size ? prev : next
    })
  }, [visible])

  useEffect(() => {
    lastQ = q
    lastFilters = filters
    lastFiltersOpen = filtersOpen
  }, [q, filters, filtersOpen])

  // Řazení se ukládá do configu, takže vydrží přepnutí na Search i restart.
  const sortSaved = useRef(false)
  useEffect(() => {
    if (!sortSaved.current) {
      sortSaved.current = true
      return
    }
    void saveConfig({ librarySort: { key: sortKey, dir: sortDir } })
  }, [sortKey, sortDir, saveConfig])

  // Záhlaví sloupců: 1. klik = výchozí směr, 2. = opačný, 3. = zpět na název složky.
  const setSort = (k: SortKey): void => {
    const first: 1 | -1 = DESC_FIRST.has(k) ? -1 : 1
    if (k !== sortKey) {
      setSortKey(k)
      setSortDir(first)
    } else if (k === 'name' || sortDir === first) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey('name')
      setSortDir(1)
    }
  }
  const sortHint = (k: SortKey, label: string): string => {
    const first: 1 | -1 = DESC_FIRST.has(k) ? -1 : 1
    if (k !== sortKey) return `Sort by ${label}`
    if (sortDir === first) return `Sorted by ${label}. Click to reverse`
    return `Sorted by ${label}. Click to turn off`
  }

  // ── Líné načítání náhledů obalů ──────────────────────────────────
  // Karty v zorném poli + rezerva jedné výšky okna nad i pod (rootMargin 100 %),
  // ať se při běžném scrollování obal načte dřív, než se řádek objeví.
  const pending = useRef<Set<string>>(new Set())
  const flushTimer = useRef<ReturnType<typeof setTimeout>>()
  const flush = useCallback((): void => {
    const batch = [...pending.current].slice(0, 16)
    batch.forEach((r) => pending.current.delete(r))
    if (!batch.length) return
    void window.api
      .libAlbumThumbs(batch)
      .then((res) => {
        for (const [r, v] of Object.entries(res)) thumbCache.set(r, v)
        setThumbs((prev) => ({ ...prev, ...res }))
      })
      .catch(() => undefined)
      .finally(() => {
        if (pending.current.size) flushTimer.current = setTimeout(flush, 0)
      })
  }, [])
  const requestThumb = useCallback(
    (rel: string): void => {
      if (thumbCache.has(rel) || pending.current.has(rel)) return
      pending.current.add(rel)
      clearTimeout(flushTimer.current)
      flushTimer.current = setTimeout(flush, 40)
    },
    [flush]
  )
  const observer = useRef<IntersectionObserver | null>(null)
  useEffect(() => {
    const io = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          if (!en.isIntersecting) continue
          const rel = (en.target as HTMLElement).dataset.thumb
          if (rel) requestThumb(rel)
          io.unobserve(en.target)
        }
      },
      { root: listRef.current, rootMargin: '100% 0px' }
    )
    observer.current = io
    return () => io.disconnect()
  }, [requestThumb])
  const observe = useCallback((el: HTMLElement | null) => {
    if (el && el.dataset.thumb && !thumbCache.has(el.dataset.thumb)) observer.current?.observe(el)
  }, [])

  // Detail vybrané písně (plný obal) do pravého panelu.
  const focusItem = focus ? items.find((i) => i.name === focus) : undefined
  useEffect(() => {
    setDetail(null)
    if (!focusItem || focusItem.kind !== 'song' || focusItem.isSng) return
    let cancelled = false
    void window.api
      .libSongDetail(focusItem.rel)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [focusItem?.rel, focusItem?.kind, focusItem?.isSng])

  // ── Výběr ─────────────────────────────────────────────────────────
  // Zaškrtnuté = cíl hromadných akcí; bez zaškrtnutí se pracuje s řádkem v detailu.
  const targetNames = (): string[] =>
    checked.size ? visible.filter((i) => checked.has(i.name)).map((i) => i.name) : focus ? [focus] : []
  const bulkItems = (names: string[]): BulkItem[] =>
    names
      .map((n) => items.find((i) => i.name === n))
      .filter((i): i is Item => !!i)
      .map((i) => ({ name: i.name, rel: i.rel, isSong: i.kind === 'song', isSng: i.isSng, info: infos[i.rel] }))

  const toggleCheck = (name: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
    setAnchor(name)
  }
  // Jediná zaškrtnutá položka se ukáže v pravém panelu, akce v něm pak míří
  // na ni (targetNames bere zaškrtnuté) a lišta nad seznamem může zmizet.
  useEffect(() => {
    if (checked.size === 1) setFocus([...checked][0])
  }, [checked])
  const allChecked = visible.length > 0 && visible.every((i) => checked.has(i.name))
  const someChecked = !allChecked && visible.some((i) => checked.has(i.name))
  const toggleAll = (): void => setChecked(allChecked ? new Set() : new Set(visible.map((i) => i.name)))

  const rowClick = (name: string, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+klik začíná vícenásobný výběr i s položkou, na kterou se klikalo
      // předtím (jako v Průzkumníku) — jinak by se tiše vynechala.
      if (checked.size === 0 && focus && focus !== name) {
        setChecked(new Set([focus, name]))
        setFocus(name)
        setAnchor(name)
      } else toggleCheck(name)
    } else if (e.shiftKey && anchor) {
      const names = visible.map((i) => i.name)
      const a = names.indexOf(anchor)
      const b = names.indexOf(name)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setChecked(new Set(names.slice(lo, hi + 1)))
      }
    } else {
      // Obyčejný klik jen přesune zvýraznění. Zaškrtnuté položky zůstávají
      // (issue #14: jeden klik vedle políčka smazal rozpracovaný výběr) — ruší
      // se tlačítkem Clear selection nebo Escapem.
      setFocus(name)
      setAnchor(name)
    }
  }
  // Posun výběru klávesnicí (šipky / Home / End), se Shiftem rozšíření rozsahu.
  const moveFocus = (step: number, extend: boolean): void => {
    const names = visible.map((i) => i.name)
    if (!names.length) return
    const cur = focus ? names.indexOf(focus) : -1
    const next =
      step === Infinity ? names.length - 1 : step === -Infinity ? 0 : cur < 0 ? 0 : Math.max(0, Math.min(names.length - 1, cur + step))
    const name = names[next]
    if (extend && anchor && names.includes(anchor)) {
      const a = names.indexOf(anchor)
      const [lo, hi] = a < next ? [a, next] : [next, a]
      setChecked(new Set(names.slice(lo, hi + 1)))
    } else setAnchor(name) // zaškrtnutí zůstává, stejně jako u kliku
    setFocus(name)
    // Doscrollovat na řádek (u virtualizovaných karet nemusí být v DOM).
    requestAnimationFrame(() => {
      const el = listRef.current
      const row = el?.querySelector('.lvrow--focus')
      if (row) row.scrollIntoView({ block: 'nearest' })
      else if (el && view === 'cards') {
        el.scrollTop = Math.max(0, next * cardRow - el.clientHeight / 2)
        requestAnimationFrame(() => el.querySelector('.lvrow--focus')?.scrollIntoView({ block: 'nearest' }))
      }
    })
  }
  const rowOpen = (it: Item): void => {
    if (it.kind === 'folder' || it.kind === 'broken') void load(it.rel)
    else if (it.kind === 'song' && !it.isSng) void playFolder(it.rel, stripTags(infos[it.rel]?.title || it.name))
  }
  const rowCtx = (name: string, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    // Pravý klik mimo zaškrtnuté → akce jen pro tenhle řádek.
    if (!checked.has(name)) setChecked(new Set())
    setFocus(name)
    setAnchor(name)
    setCtx({ x: e.clientX, y: e.clientY })
  }

  // Stabilní handlery pro memoizované řádky.
  const startFix = useStore((s) => s.startFix)
  const fixItem = (it: Item): void => {
    const q = fixQuery(it.label)
    startFix(it.rel, it.label, q.artist, q.title)
  }
  // Zaškrtnuté písně zůstávají (preview nesmí zrušit rozpracovaný výběr).
  const selectOnly = (name: string): void => {
    setFocus(name)
    setAnchor(name)
  }
  // Klik na interpreta / album v kartě: ukáže jeho písně v aktuální složce
  // (včetně podsložek, jako ostatní filtry).
  const filterBy = (artist: string, album?: string): void => {
    setFilters((f) => ({ ...f, artist: stripTags(artist).trim(), album: album ? stripTags(album).trim() : '' }))
    setQ('')
    setFiltersOpen(true)
  }
  // Klik na chartera v kartě: jeho písně v aktuální složce (vč. podsložek).
  const filterCharter = (charter: string): void => {
    setFilters((f) => ({ ...f, charter: stripTags(charter).trim() }))
    setQ('')
    setFiltersOpen(true)
  }
  const h = useRef({ rowClick, rowOpen, rowCtx, toggleCheck, observe, fixItem, selectOnly, filterBy, filterCharter })
  h.current = { rowClick, rowOpen, rowCtx, toggleCheck, observe, fixItem, selectOnly, filterBy, filterCharter }
  const handlers = useMemo<RowHandlers>(
    () => ({
      click: (n, e) => h.current.rowClick(n, e),
      open: (it) => h.current.rowOpen(it),
      ctx: (n, e) => h.current.rowCtx(n, e),
      select: (n) => h.current.selectOnly(n),
      check: (n) => h.current.toggleCheck(n),
      observe: (el) => h.current.observe(el),
      fix: (it) => h.current.fixItem(it),
      filterBy: (artist, album) => h.current.filterBy(artist, album),
      filterCharter: (charter) => h.current.filterCharter(charter)
    }),
    []
  )

  // ── Akce ──────────────────────────────────────────────────────────
  const doCopy = (op: 'cut' | 'copy'): void => {
    const names = targetNames()
    if (names.length) setClip({ op, items: names.map(relOf), names })
  }
  const [askExisting, existingDialog] = useExistingCheck()
  const doPaste = (): void => {
    if (!clip) return
    const c = clip
    void (async () => {
      // Ochrana proti duplicitám: co už v cílové složce je, nabídnout přeskočit.
      const keep = await askExisting(c.items, cwd, c.op === 'cut' ? 'Move' : 'Copy')
      if (!keep) return
      const todo = c.items.filter((i) => keep.includes(i))
      if (!todo.length) {
        if (c.op === 'cut') setClip(null)
        return
      }
      await pasteItems(c, todo)
    })()
  }
  const pasteItems = (c: NonNullable<Clip>, todo: string[]): Promise<void> =>
    run(async () => {
      if (c.op === 'cut') useStore.getState().releaseFiles(todo)
      for (const item of todo) {
        if (c.op === 'cut') await window.api.libMove(item, cwd)
        else await window.api.libCopy(item, cwd)
      }
      if (c.op === 'cut') setClip(null)
    })
  const openRename = (): void => {
    const names = targetNames()
    if (names.length === 1) {
      setDialog({ type: 'rename', name: names[0] })
      setDialogValue(names[0].split('/').pop() ?? names[0])
    } else if (names.length > 1) setDialog({ type: 'bulkRename', names })
  }
  const openDelete = (): void => {
    const names = targetNames()
    if (names.length) setDialog({ type: 'delete', names })
  }
  const openPick = (mode: 'move' | 'copy'): void => {
    const names = targetNames()
    if (names.length) setDialog({ type: 'pick', mode, names })
  }
  const openPlaylist = (): void => {
    const rels = bulkItems(targetNames()).filter((i) => i.isSong && !i.isSng).map((i) => i.rel)
    if (rels.length) setPlaylistFor(rels)
  }

  const confirmDialog = async (): Promise<void> => {
    const d = dialog
    if (!d) return
    setDialog(null)
    if (d.type === 'rename' && d.base !== undefined) sideAffect.current = relIn(d.base, d.name)
    if (d.type === 'delete' && d.base !== undefined) sideAffect.current = relIn(d.base, d.names[0])
    if (d.type === 'new') await run(() => window.api.libCreateFolder(cwd, dialogValue.trim()))
    else if (d.type === 'rename') {
      useStore.getState().releaseFiles([relIn(d.base, d.name)])
      await run(() => window.api.libRename(relIn(d.base, d.name), dialogValue.trim()))
    }
    else if (d.type === 'delete')
      await run(async () => {
        useStore.getState().releaseFiles(d.names.map((n) => relIn(d.base, n)))
        for (const n of d.names) await window.api.libTrash(relIn(d.base, n))
        setChecked(new Set())
        setFocus(null)
      }, config?.deleteMode === 'permanent'
        ? `Deleted ${d.names.length} item${d.names.length === 1 ? '' : 's'} permanently`
        : `Moved ${d.names.length} item${d.names.length === 1 ? '' : 's'} to the ${IS_MAC ? 'Trash' : 'Recycle Bin'}`)
  }

  const bulkDone = (msg: string): void => {
    if (msg) {
      setDialog(null)
      setChecked(new Set())
      showToast(msg)
    }
    void load(reloadPath(), !msg)
    loadTree()
  }

  // Klávesové zkratky (document = dřív než globální handler aplikace na window).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (ctx) {
          setCtx(null)
          e.stopPropagation()
        } else if (anyDialog) {
          // Dialog zavírá sám sebe; Escape nesmí přepnout zpět na hledání.
          if (dialog) setDialog(null)
          e.stopPropagation()
        } else if (checked.size) {
          setChecked(new Set())
          e.stopPropagation()
        }
        return
      }
      if (isTypingTarget(e.target) || anyDialog || existingDialog) return
      const ctrl = e.ctrlKey || e.metaKey
      // Otevřené menu složky z levého panelu: zkratky míří na tu složku, ne na
      // vybranou položku v seznamu.
      if (ctx?.side !== undefined) {
        const n = ctx.side
        if (e.key === 'Delete' || (IS_MAC && ctrl && e.key === 'Backspace')) {
          e.preventDefault()
          setDialog({ type: 'delete', names: [n], base: '' })
        } else if (e.key === 'F2') {
          e.preventDefault()
          setDialog({ type: 'rename', name: n, base: '' })
          setDialogValue(n)
        } else if (ctrl && e.key.toLowerCase() === 'c') setClip({ op: 'copy', items: [n], names: [n] })
        else if (ctrl && e.key.toLowerCase() === 'x') setClip({ op: 'cut', items: [n], names: [n] })
        else return
        setCtx(null)
        return
      }
      // Šipky nahoru/dolů posouvají výběr, se Shiftem ho rozšiřují; Home/End na
      // začátek/konec. Enter otevře složku nebo pustí píseň (na macu je Enter
      // přejmenování jako ve Finderu, tam zůstává dvojklik).
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'End' ? Infinity : e.key === 'Home' ? -Infinity : 0
      if (step && !ctrl && !e.altKey) {
        e.preventDefault()
        moveFocus(step, e.shiftKey)
        return
      }
      if (e.key === 'Enter' && !IS_MAC && !ctrl) {
        const it = visible.find((i) => i.name === focus)
        if (it) {
          e.preventDefault()
          rowOpen(it)
        }
        return
      }
      const isDelete = e.key === 'Delete' || (IS_MAC && ctrl && e.key === 'Backspace')
      if (isDelete) {
        e.preventDefault()
        openDelete()
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setChecked(new Set(visible.map((i) => i.name)))
      } else if (ctrl && e.key.toLowerCase() === 'c') doCopy('copy')
      else if (ctrl && e.key.toLowerCase() === 'x') doCopy('cut')
      else if (ctrl && e.key.toLowerCase() === 'v') doPaste()
      else if (e.key === 'F2' || (IS_MAC && e.key === 'Enter')) {
        e.preventDefault()
        openRename()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useLayoutEffect(() => {
    const el = ctxRef.current
    if (!ctx || !el) return
    const pad = 8
    const r = el.getBoundingClientRect()
    let { x, y } = ctx
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - r.height - pad)
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - r.width - pad)
    el.style.top = `${y}px`
    el.style.left = `${x}px`
  }, [ctx])

  const changeView = (v: 'cards' | 'list'): void => {
    setView(v)
    void saveConfig({ libraryView: v })
  }

  // ── Render ────────────────────────────────────────────────────────
  const checkedSngCount = checked.size > 1 ? visible.filter((i) => checked.has(i.name) && i.isSng).length : 0
  // Do přehrávače jdou vybrané písně i složky (hrají se celé), v pořadí seznamu.
  const checkedBroken = checked.size > 1 ? visible.filter((i) => checked.has(i.name) && i.kind === 'broken') : []
  const playableChecked = checked.size > 1 ? visible.filter((i) => checked.has(i.name) && (i.kind === 'song' || i.kind === 'folder') && !i.isSng) : []
  const targets = targetNames()
  const targetSongs = bulkItems(targets).filter((i) => i.isSong && !i.isSng).length
  const single = targets.length === 1 ? items.find((i) => i.name === targets[0]) : undefined
  const songCount = items.filter((i) => i.kind === 'song').length
  const cutSet = new Set(clip && clip.op === 'cut' ? clip.items : [])
  const extId = segments[0]?.startsWith('::') ? segments[0].slice(2) : null
  const inExt = extId !== null
  const extInfo = inExt ? extFolders.find((f) => f.id === extId) : undefined
  const topFolder = inExt ? '' : segments[0] ?? ''
  const addExtFolder = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (!dir) return
    try {
      const f = await window.api.libAddExtraFolder(dir)
      loadTree()
      setTool(null)
      void load(`::${f.id}`)
    } catch (e) {
      setError(userMsg(e))
    }
  }
  const removeExtFolder = async (id: string): Promise<void> => {
    await window.api.libRemoveExtraFolder(id)
    lastExtFolders = lastExtFolders.filter((f) => f.id !== id)
    setExtFolders(lastExtFolders)
    if (segments[0] === `::${id}`) void load('')
  }

  return (
    <div className={`lv ${inExt ? 'lv--ext' : ''}`}>
      {/* ── Strom: složky nejvyšší úrovně, playlisty, duplicity ── */}
      <aside className="lv__tree" aria-label="Library folders">
        {/* Nástroje nahoře, ať nejsou pod dlouhým seznamem složek. */}
        <div className="lv__treesec">
          <div className="lv__treelabel lv__treelabel--tools">Tools</div>
          <button
            type="button"
            className={`lv__titem ${tool === 'setlists' ? 'lv__titem--on' : ''}`}
            onClick={() => setTool('setlists')}
          >
            <Icon name="note" size={15} className="lv__ttool lv__ttool--setlists" />
            <span className="lv__tname">Setlists</span>
          </button>
          <button
            type="button"
            className={`lv__titem ${tool === 'duplicates' ? 'lv__titem--on' : ''}`}
            onClick={() => setTool('duplicates')}
          >
            <Icon name="copy" size={15} className="lv__ttool lv__ttool--dups" />
            <span className="lv__tname">Duplicates</span>
          </button>
        </div>
        {/* Další složky s charty mimo Songs (archiv na jiném disku…). Procházejí
            se stejně jako Songs; Copy to… / Move to… míří do Songs. */}
        <div className="lv__treesec">
          <div className="lv__treelabel lv__treelabel--other">Other folders</div>
          {extFolders.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`lv__titem ${!tool && extId === f.id ? 'lv__titem--on' : ''} ${ctx?.ext === f.id ? 'lv__titem--ctx' : ''}`}
              onClick={() => {
                setTool(null)
                void load(`::${f.id}`)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCtx({ x: e.clientX, y: e.clientY, ext: f.id })
              }}
              title={f.path}
            >
              <Icon name="folder" size={15} className="lv__tfolder" />
              <ScrollName text={f.name} />
            </button>
          ))}
          <button type="button" className="lv__titem lv__titem--add" onClick={() => void addExtFolder()} title="Browse another folder with charts, like an archive on another drive">
            <Icon name="plus" size={15} />
            <span className="lv__tname">Add folder…</span>
          </button>
        </div>
        <div className="lv__treesec">
          <div className="lv__treelabel lv__treelabel--songs">Songs</div>
          <button
            type="button"
            className={`lv__titem ${!tool && cwd === '' ? 'lv__titem--on' : ''}`}
            onClick={() => {
              setTool(null)
              void load('')
            }}
          >
            <Icon name="folder" size={15} className="lv__tfolder" />
            <span className="lv__tname">All folders</span>
            <span className="lv__tcount">{rootDirs.length}</span>
          </button>
          {rootDirs.map((d) => (
            <button
              key={d.name}
              type="button"
              className={`lv__titem ${!tool && topFolder === d.name ? 'lv__titem--on' : ''} ${ctx?.side === d.name ? 'lv__titem--ctx' : ''}`}
              onClick={() => {
                setTool(null)
                void load(d.name)
              }}
              onContextMenu={(e) => {
                // Stejné akce jako u složky v seznamu, ale bez opuštění otevřené složky.
                e.preventDefault()
                e.stopPropagation()
                setCtx({ x: e.clientX, y: e.clientY, side: d.name })
              }}
              title={d.name}
            >
              <Icon name="folder" size={15} className="lv__tfolder" />
              <ScrollName text={d.name} />
              <span className="lv__tcount">{rootCounts[d.name] ?? ''}</span>
            </button>
          ))}
        </div>
      </aside>

      {tool === 'setlists' ? (
        <SetlistsView
          onReveal={(rel) => {
            setTool(null)
            void revealTarget(rel)
          }}
        />
      ) : tool === 'duplicates' ? (
        <DuplicatesView
          onChanged={() => {
            void load(cwd, true)
            loadTree()
          }}
          onReveal={(rel) => {
            setTool(null)
            void revealTarget(rel)
          }}
        />
      ) : null}
      <section className="lv__main" aria-label="Library" hidden={tool !== null}>
        {/* Dva řádky: cesta + akce se složkou nahoře, hledání / řazení / pohled
            dole. Spodní řádek se na úzkém okně zalomí, nic se neschová pod panel. */}
        <div className="lv__bar">
          <div className="lv__barrow lv__barrow--path">
            <button
              className="lib__btn lib__btn--icon"
              onClick={() => void load(segments.slice(0, -1).join('/'))}
              disabled={!cwd || (inExt && segments.length === 1)}
              title="Up one folder"
            >
              <Icon name="chevronLeft" size={15} />
            </button>
            <div className="lib__crumbs lv__crumbs" ref={crumbsRef}>
              <button className="crumb" onClick={() => void load(inExt ? segments[0] : '')} title={extInfo?.path}>
                <Icon name="folder" size={14} /> {inExt ? extInfo?.name ?? 'Folder' : 'Songs'}
              </button>
              {segments.map((seg, i) => (inExt && i === 0 ? null :
                <span key={i} className="crumb__wrap">
                  <span className="crumb__sep">/</span>
                  <button className="crumb" onClick={() => void load(segments.slice(0, i + 1).join('/'))}>
                    {seg}
                  </button>
                </span>
              ))}
            </div>
            <div className="lv__bartools">
              <button className="lib__btn lib__btn--icon" onClick={() => { setDialog({ type: 'new' }); setDialogValue('') }} title="New folder">
                <Icon name="folderPlus" size={15} />
              </button>
              <button className="lib__btn lib__btn--icon" onClick={() => window.api.libOpen(cwd)} title={IS_MAC ? 'Open in Finder' : 'Open in Explorer'}>
                <Icon name="external" size={15} />
              </button>
              <button className="lib__btn lib__btn--icon" onClick={() => { forgetSongData(); void load(cwd, true); loadTree() }} title="Refresh">
                <Icon name="refresh" size={15} />
              </button>
            </div>
          </div>
          {inExt ? (
            // Další složka není složka Songs — hra ji neprochází (ať nikdo nečeká písně ve hře).
            <div className="lv__extnote">
              <Icon name="info" size={13} /> Clone Hero doesn't scan this folder. Copy songs to your Songs folder to play them.
            </div>
          ) : null}
          <div className="lv__barrow">
            <label className="lv__search" htmlFor="lv-q">
              <Icon name="search" size={14} />
              <input
                id="lv-q"
                type="search"
                placeholder="Filter…"
                title="Filter this folder by name, title, artist or album"
                value={q}
                autoComplete="off"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.stopPropagation()
                    setQ('')
                  }
                }}
              />
            </label>
            <div className="lib__sort" title="Sort">
              <select
                className="lib__sortsel"
                aria-label="Sort by"
                value={sortKey}
                onChange={(e) => {
                  const k = e.target.value as SortKey
                  setSortKey(k)
                  setSortDir(DESC_FIRST.has(k) ? -1 : 1)
                }}
              >
                {(['File', 'Song', 'Intensity'] as const).map((g) => (
                  <optgroup key={g} label={g}>
                    {SORTS.filter((s) => s.group === g).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                className="lib__sortdir"
                title={sortDir === 1 ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
              >
                <Icon name="caret" size={12} style={{ transform: sortDir === 1 ? 'rotate(180deg)' : 'none' }} />
              </button>
            </div>
            <button
              className={`lib__btn ${filtersOpen ? 'lib__btn--on' : ''}`}
              onClick={() => {
                setFiltersOpen((v) => !v)
                // Seznam jen po dobu vysouvání na vlastní vrstvě (plynulá roleta);
                // natrvalo by vrstva zpomalovala scrollování.
                const el = listRef.current
                if (el) {
                  el.classList.add('lv__list--rolling')
                  window.setTimeout(() => el.classList.remove('lv__list--rolling'), 400)
                }
              }}
              aria-expanded={filtersOpen}
            >
              <Icon name="filter" size={14} /> Filters
              {activeFilterCount ? <span className="lv__fcount">{activeFilterCount}</span> : null}
            </button>
            <div className="lv__seg" role="group" aria-label="View">
              <button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => changeView('cards')} title="Cards: album art, difficulty, intensity, preview">
                <Icon name="cards" size={15} />
              </button>
              <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="List: compact">
                <Icon name="list" size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Filtry se vysouvají roletou stejně jako panel filtrů v hledání. */}
        <div className={`lvfroll ${filtersOpen ? 'lvfroll--open' : ''}`} aria-hidden={!filtersOpen}>
          <div className="lvfroll__inner">
          <div className="lv__filters">
            <div className="lv__fgroup">
              <span className="lv__flabel">Instruments</span>
              <div className="lv__chips">
                {INSTRUMENTS.map((i) => {
                  const on = filters.inst.includes(i.id)
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className={`lv__chip ${on ? 'lv__chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        setFilters((f) => ({ ...f, inst: on ? f.inst.filter((x) => x !== i.id) : [...f.inst, i.id] }))
                      }
                    >
                      <Icon name={i.icon} size={15} color={on ? i.color : undefined} /> {i.label}
                    </button>
                  )
                })}
              </div>
              <span className="lv__fhint">Only songs with every selected instrument charted.</span>
            </div>
            <div className="lv__fgroup">
              <span className="lv__flabel">Intensity</span>
              <div className="lv__range">
                <select
                  className="lib__sortsel"
                  aria-label="Minimum intensity"
                  value={filters.min}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setFilters((f) => ({ ...f, min: v, max: Math.max(v, f.max) }))
                  }}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span>to</span>
                <select
                  className="lib__sortsel"
                  aria-label="Maximum intensity"
                  value={filters.max}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setFilters((f) => ({ ...f, max: v, min: Math.min(v, f.min) }))
                  }}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <span className="lv__fhint">
                {filters.inst.length
                  ? 'Every selected instrument must be in this range.'
                  : 'No instrument selected: any instrument in this range.'}
              </span>
            </div>
            <div className="lv__fgroup">
              <span className="lv__flabel">Includes difficulties</span>
              <div className="lv__chips">
                {(() => {
                  const levelChip = (l: (typeof LEVELS)[number]): JSX.Element => {
                    const on = !filters.expertOnly && filters.levels.includes(l.id)
                    return (
                      <button
                        key={l.id}
                        type="button"
                        className={`lv__chip lv__chip--lv-${l.id} ${on ? 'lv__chip--on' : ''}`}
                        aria-pressed={on}
                        onClick={() =>
                          setFilters((f) => ({
                            ...f,
                            expertOnly: false,
                            levels: on ? f.levels.filter((x) => x !== l.id) : [...f.levels, l.id]
                          }))
                        }
                      >
                        {l.label}
                      </button>
                    )
                  }
                  return (
                    <>
                      {LEVELS.slice(0, 3).map(levelChip)}
                      {/* Expert + čára + Expert only drží pohromadě, ať čára při
                          zalomení nezůstane sama na kraji řádku. */}
                      <span className="lv__chipgroup">
                        {levelChip(LEVELS[3])}
                        <span className="lv__chipsep" aria-hidden="true" />
                        <button
                          type="button"
                          className={`lv__chip lv__chip--lv-x ${filters.expertOnly ? 'lv__chip--on' : ''}`}
                          aria-pressed={filters.expertOnly}
                          title="Only charts with no easier difficulty than Expert"
                          onClick={() => setFilters((f) => ({ ...f, expertOnly: !f.expertOnly, levels: [] }))}
                        >
                          Expert only
                        </button>
                      </span>
                    </>
                  )
                })()}
              </div>
              <span className="lv__fhint">
                {filters.expertOnly
                  ? 'Only charts with no easier difficulty than Expert.'
                  : 'Songs that include every selected difficulty.'}
                {levelFilter && levelsLoading ? ' (still reading charts…)' : ''}
              </span>
            </div>
            <div className="lv__fgroup">
              <span className="lv__flabel">Problems</span>
              <div className="lv__chips">
                <button
                  type="button"
                  className={`lv__chip lv__chip--warn ${filters.broken ? 'lv__chip--on' : ''}`}
                  aria-pressed={filters.broken}
                  onClick={() => setFilters((f) => ({ ...f, broken: !f.broken }))}
                >
                  <Icon name="alert" size={14} /> Broken songs{brokenCount ? ` (${brokenCount})` : ''}
                </button>
              </div>
              <button className="lv__link lv__fclear" type="button" disabled={!activeFilterCount} onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            </div>
            {/* Textová pole vedle sebe na vlastním řádku. */}
            <div className="lv__ftext">
              <div className="lv__fgroup">
                <span className="lv__flabel">Artist</span>
                <input
                  className="lv__finput"
                  placeholder="e.g. Linkin Park"
                  value={filters.artist}
                  onChange={(e) => setFilters((f) => ({ ...f, artist: e.target.value }))}
                />
              </div>
              <div className="lv__fgroup">
                <span className="lv__flabel">Album</span>
                <input
                  className="lv__finput"
                  placeholder="e.g. Meteora"
                  value={filters.album}
                  onChange={(e) => setFilters((f) => ({ ...f, album: e.target.value }))}
                />
              </div>
              <div className="lv__fgroup">
                <span className="lv__flabel">Charter</span>
                <input
                  className="lv__finput"
                  placeholder="Charter name"
                  value={filters.charter}
                  onChange={(e) => setFilters((f) => ({ ...f, charter: e.target.value }))}
                />
                <span className="lv__fhint">
                  {visible.filter((i) => i.kind === 'song').length} of {songCount} songs match
                  {metaFilter ? ', including subfolders' : ''}
                  {infoLoading ? ' (still reading song details…)' : ''}
                </span>
              </div>
            </div>
          </div>
          </div>
        </div>

        {libraryReveal && libraryReveal.length > 1 ? (
          <div className="lib__reveal">
            <span className="lib__reveal-label">{libraryReveal.length} copies — jump to:</span>
            {libraryReveal.map((rel) => (
              <button
                key={rel}
                className={`lib__reveal-chip ${revealActive === rel ? 'lib__reveal-chip--on' : ''}`}
                title={rel}
                onClick={() => void revealTarget(rel)}
              >
                {rel}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className="lib__error">⚠ {error}</div> : null}

        {checked.size > 0 ? (
          // Stejné akce má pravý panel, takže se lišta schová; na užším okně,
          // kde panel není, zůstane (viz styles.css).
          <div className="lv__bulk lv__bulk--multi">
            <span className="lv__bulkcount">{checked.size} selected</span>
            <button className="lib__btn" onClick={openRename}>
              <Icon name="charter" size={14} /> Rename…
            </button>
            <button className="lib__btn" onClick={() => openPick('move')}>
              <Icon name="arrowRight" size={14} /> Move to…
            </button>
            <button className="lib__btn" onClick={() => openPick('copy')}>
              <Icon name="copy" size={14} /> Copy to…
            </button>
            {inExt ? null : (
              <button className="lib__btn" disabled={!targetSongs} onClick={openPlaylist}>
                <Icon name="note" size={14} /> Add to setlist
              </button>
            )}
            <button className="lib__btn lv__danger" onClick={openDelete}>
              <Icon name="trash" size={14} /> Delete
            </button>
            <div className="lib__spacer" />
            <button className="lv__link" type="button" onClick={() => setChecked(new Set())}>
              Clear selection
            </button>
          </div>
        ) : null}

        <div className={`lv__head lv__head--${view}`}>
          <label className="chk" title="Select all">
            <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked }} onChange={toggleAll} />
            <span className="chk__box">
              <Icon name={someChecked ? 'minimize' : 'check'} size={12} />
            </span>
          </label>
          {view === 'cards' ? (
            <>
              <span />
              <span className="lv__hsorts">
                {(['title', 'artist', 'album', 'length'] as SortKey[]).map((k) => {
                  const label = SORTS.find((s) => s.id === k)?.label ?? k
                  return (
                    <button
                      key={k}
                      type="button"
                      className={sortKey === k ? 'on' : ''}
                      title={sortHint(k, label.toLowerCase())}
                      onClick={() => setSort(k)}
                    >
                      {label}
                      <SortArrow on={sortKey === k} dir={sortDir} />
                    </button>
                  )
                })}
              </span>
              <span className="lv__hinst">
                {INSTRUMENTS.map((i) => {
                  const k = `d:${i.id}` as SortKey
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className={sortKey === k ? 'on' : ''}
                      title={sortHint(k, `${i.label} difficulty`)}
                      onClick={() => setSort(k)}
                    >
                      <Icon name={i.icon} size={18} color={i.color} />
                      <SortArrow on={sortKey === k} dir={sortDir} />
                    </button>
                  )
                })}
              </span>
              <span />
              <span />
            </>
          ) : (
            <>
              <span />
              <button type="button" className={`lv__hname ${sortKey === 'name' ? 'on' : ''}`} onClick={() => setSort('name')}>
                Name
                <SortArrow on={sortKey === 'name'} dir={sortDir} />
              </button>
              <span />
            </>
          )}
        </div>

        <div
          ref={listRef}
          className={`lv__list lv__list--${view}`}
          onScroll={(e) => {
            const st = e.currentTarget.scrollTop
            if (snap && snap.path === cwd) snap.scroll = st
            if (!vRaf.current) {
              vRaf.current = requestAnimationFrame(() => {
                vRaf.current = 0
                setVScroll(listRef.current?.scrollTop ?? 0)
              })
            }
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault()
              setChecked(new Set())
              setFocus(null)
              setCtx({ x: e.clientX, y: e.clientY })
            }
          }}
          onMouseDown={(e) => {
            // Klik do prázdna zruší jen zvýraznění, zaškrtnutí zůstává (viz rowClick).
            if (e.target === e.currentTarget && !e.ctrlKey && !e.metaKey && !e.shiftKey) setFocus(null)
          }}
        >
          {loading && !entries.length ? (
            <div className="lib__empty">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="lib__empty">This folder is empty. Right-click for New folder / Paste.</div>
          ) : visible.length === 0 ? (
            <div className="lib__empty">
              Nothing matches.{' '}
              {activeFilterCount || q ? (
                <button className="lv__link" type="button" onClick={() => { setFilters(NO_FILTERS); setQ('') }}>
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            (() => {
              visibleRef.current = visible
              const virt = view === 'cards' && visible.length > VIRT_MIN
              // Začátek vždy na sudém indexu: zebra pruhy (nth-child) pak při
              // scrollu neproblikávají.
              const start0 = virt ? Math.max(0, Math.floor(vScroll / cardRow) - VIRT_OVERSCAN) : 0
              const start = start0 - (start0 % 2)
              const end = virt ? Math.min(visible.length, Math.ceil((vScroll + vHeight) / cardRow) + VIRT_OVERSCAN) : visible.length
              const rows = visible.slice(start, end).map((it) => (
              <LibRow
                // Klíč = celá cesta: stejně pojmenovaná píseň v jiné složce musí
                // dostat nový řádek, jinak se pro ni nevyžádá náhled obalu.
                key={it.rel}
                it={it}
                view={view}
                info={infos[it.rel]}
                levels={levels[it.rel]}
                thumb={thumbs[it.rel]}
                count={it.kind === 'folder' ? folderCounts[it.name] : undefined}
                checked={checked.has(it.name)}
                focused={focus === it.name}
                cut={cutSet.has(it.rel)}
                h={handlers}
              />
              ))
              if (!virt) return rows
              return (
                <>
                  <div className="lv__vspace" style={{ height: start * cardRow }} aria-hidden="true" />
                  {rows}
                  <div className="lv__vspace" style={{ height: (visible.length - end) * cardRow }} aria-hidden="true" />
                </>
              )
            })()
          )}
        </div>

        <div className="lib__actions">
          <span className="lib__selinfo">
            {visible.length === items.length ? `${items.length} items` : `${visible.length} of ${items.length} items`}
            {checked.size ? ` · ${checked.size} selected` : ''}
            {clip ? ` · ${clip.items.length} on clipboard (${clip.op})` : ''}
          </span>
          {checked.size ? (
            <button type="button" className="lv__link lv__clearsel" onClick={() => setChecked(new Set())}>
              Clear selection
            </button>
          ) : null}
          {brokenCount ? (
            <button
              type="button"
              className={`lv__brokenlink ${filters.broken ? 'lv__brokenlink--on' : ''}`}
              title={filters.broken ? 'Show everything again' : 'Show only song folders with missing files'}
              onClick={() => setFilters((f) => ({ ...f, broken: !f.broken }))}
            >
              <Icon name="alert" size={13} /> {brokenCount} broken {brokenCount === 1 ? 'song' : 'songs'}
            </button>
          ) : null}
          {brokenCount && !bulkRun ? (
            <button
              type="button"
              className="lv__fixall"
              title="Find a replacement for every broken song in this folder and its subfolders"
              onClick={() => openBulkFix(brokenTargets())}
            >
              Fix all
            </button>
          ) : null}
          {bulkRun ? (
            <span className={`lv__bulkrun ${fixedCount >= bulkRun.total ? 'lv__bulkrun--done' : ''}`} role="status">
              {fixedCount >= bulkRun.total ? (
                <>
                  <Icon name="check" size={13} /> Fixed {bulkRun.ok} of {bulkRun.total}
                  {bulkRun.failed ? ` · ${bulkRun.failed} failed` : ''}
                  <button type="button" className="lv__bulkrun-x" onClick={dismissBulkRun} aria-label="Dismiss">
                    <Icon name="close" size={11} />
                  </button>
                </>
              ) : (
                <>
                  <i className="catact__spin" aria-hidden="true" /> Fixing broken songs {fixedCount}/{bulkRun.total}
                </>
              )}
            </span>
          ) : null}
          <div className="lib__spacer" />
          {clip ? (
            <button className="lib__btn lib__btn--accent" onClick={doPaste}>
              <Icon name="paste" size={14} /> Paste ({clip.items.length})
            </button>
          ) : null}
          <span className="lib__hint">
            {IS_MAC
              ? 'Right-click for actions · ⌘A · ⌘C/X/V · ⌘⌫ · ↩'
              : 'Right-click for actions · Ctrl+A · Ctrl+C/X/V · Del · F2'}
          </span>
        </div>
      </section>

      {/* ── Detail ── */}
      <aside className="lv__detail" aria-label="Details" hidden={tool !== null}>
        {checked.size > 1 ? (
          <div className="lv__dmulti">
            <CoverStack
              items={visible.filter((i) => checked.has(i.name) && i.kind === 'song')}
              infos={infos}
            />
            <div className="lv__dlabel">{checked.size} items selected</div>
            <PanelActions
              primary={
                checkedBroken.length
                  ? {
                      label: `Fix ${checkedBroken.length} broken ${checkedBroken.length === 1 ? 'song' : 'songs'}`,
                      icon: 'alert',
                      onClick: () => openBulkFix(checkedBroken.map((i) => ({ rel: i.rel, name: i.label })))
                    }
                  : undefined
              }
              onPlay={
                playableChecked.length
                  ? () => void playFolders(playableChecked.map((i) => i.rel), `${playableChecked.length} selected`)
                  : undefined
              }
              onPlaylist={targetSongs && !inExt ? openPlaylist : undefined}
              onUnpack={checkedSngCount ? unpackSng : undefined}
              unpackLabel={`Unpack ${checkedSngCount} .sng file${checkedSngCount === 1 ? '' : 's'}`}
              onRename={openRename}
              onMove={() => openPick('move')}
              onCopy={() => openPick('copy')}
              onDelete={openDelete}
            />
          </div>
        ) : focusItem ? (
          <DetailPanel
            it={focusItem}
            info={infos[focusItem.rel]}
            levels={levels[focusItem.rel]}
            detail={detail}
            count={focusItem.kind === 'folder' ? folderCounts[focusItem.name] : undefined}
            onOpen={() => void load(focusItem.rel)}
            onPlay={() => void playFolder(focusItem.rel, stripTags(infos[focusItem.rel]?.title || focusItem.name))}
            onMeta={() => setMetaFor({ rel: focusItem.rel, title: focusItem.name })}
            onReveal={() => window.api.libReveal(focusItem.rel)}
            onDelete={() => setDialog({ type: 'delete', names: [focusItem.name] })}
            onFix={() => fixItem(focusItem)}
            onUnpack={focusItem.isSng ? unpackSng : undefined}
            onPlaylist={focusItem.kind === 'song' && !focusItem.isSng && !inExt ? openPlaylist : undefined}
            onRename={openRename}
            onMove={() => openPick('move')}
            onCopy={() => openPick('copy')}
          />
        ) : (
          <div className="lv__dempty">
            <Icon name="note" size={26} />
            <span>Pick a song to see its album art, details and actions.</span>
          </div>
        )}
      </aside>

      {/* ── Kontextové menu ── */}
      {ctx ? (
        <>
          <div
            className="ctxmenu__backdrop"
            onMouseDown={(e) => {
              e.stopPropagation()
              setCtx(null)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx(null)
            }}
          />
          <div ref={ctxRef} className="ctxmenu" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
            {ctx.ext !== undefined ? (
              (() => {
                const id = ctx.ext
                const act = (fn: () => void) => () => {
                  fn()
                  setCtx(null)
                }
                return (
                  <>
                    <button className="ctxmenu__item" onClick={act(() => { setTool(null); void load(`::${id}`) })}>
                      <Icon name="folder" size={14} /> Open
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => void playFolder(`::${id}`, extFolders.find((f) => f.id === id)?.name ?? 'Folder'))}>
                      <Icon name="play" size={14} /> Listen in music player
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => window.api.libOpen(`::${id}`))}>
                      <Icon name="external" size={14} /> {IS_MAC ? 'Open in Finder' : 'Open in Explorer'}
                    </button>
                    <div className="ctxmenu__sep" />
                    <button className="ctxmenu__item" title="The folder and its files stay on your drive" onClick={act(() => void removeExtFolder(id))}>
                      <Icon name="close" size={14} /> Remove from list
                    </button>
                  </>
                )
              })()
            ) : ctx.side !== undefined ? (
              (() => {
                const n = ctx.side
                const act = (fn: () => void) => () => {
                  fn()
                  setCtx(null)
                }
                return (
                  <>
                    <button className="ctxmenu__item" onClick={act(() => { setTool(null); void load(n) })}>
                      <Icon name="folder" size={14} /> Open
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => void playFolder(n, n))}>
                      <Icon name="play" size={14} /> Listen in music player
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => { setDialog({ type: 'rename', name: n, base: '' }); setDialogValue(n) })}>
                      <Icon name="charter" size={14} /> Rename
                    </button>
                    <div className="ctxmenu__sep" />
                    <button className="ctxmenu__item" onClick={act(() => setClip({ op: 'copy', items: [n], names: [n] }))}>
                      <Icon name="copy" size={14} /> Copy
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => setClip({ op: 'cut', items: [n], names: [n] }))}>
                      <Icon name="scissors" size={14} /> Cut
                    </button>
                    <button className="ctxmenu__item" onClick={act(() => setDialog({ type: 'pick', mode: 'move', names: [n], base: '' }))}>
                      <Icon name="arrowRight" size={14} /> Move to…
                    </button>
                    <button className="ctxmenu__item ctxmenu__item--danger" onClick={act(() => setDialog({ type: 'delete', names: [n], base: '' }))}>
                      <Icon name="trash" size={14} /> Delete
                    </button>
                  </>
                )
              })()
            ) : (
            <>
            {single && (single.kind === 'folder' || single.kind === 'broken') ? (
              <button className="ctxmenu__item" onClick={() => { void load(single.rel); setCtx(null) }}>
                <Icon name="folder" size={14} /> Open
              </button>
            ) : null}
            {single && single.e.type === 'dir' && single.kind !== 'broken' ? (
              <button className="ctxmenu__item" onClick={() => { void playFolder(single.rel, stripTags(infos[single.rel]?.title || single.name)); setCtx(null) }}>
                <Icon name="play" size={14} /> {single.kind === 'song' ? 'Play' : 'Listen in music player'}
              </button>
            ) : null}
            {targets.length ? (
              <button className="ctxmenu__item" onClick={() => { openRename(); setCtx(null) }}>
                <Icon name="charter" size={14} /> {targets.length > 1 ? `Rename ${targets.length} items…` : 'Rename'}
              </button>
            ) : null}
            {single && single.kind === 'song' && !single.isSng ? (
              <button className="ctxmenu__item" onClick={() => { setMetaFor({ rel: single.rel, title: single.name }); setCtx(null) }}>
                <Icon name="file" size={14} /> Edit metadata
              </button>
            ) : null}
            {targetSongs > 0 && !inExt ? (
              <button className="ctxmenu__item" onClick={() => { openPlaylist(); setCtx(null) }}>
                <Icon name="note" size={14} /> Add to setlist ({targetSongs})
              </button>
            ) : null}
            {targets.length ? (
              <>
                <div className="ctxmenu__sep" />
                <button className="ctxmenu__item" onClick={() => { doCopy('copy'); setCtx(null) }}>
                  <Icon name="copy" size={14} /> Copy
                </button>
                <button className="ctxmenu__item" onClick={() => { doCopy('cut'); setCtx(null) }}>
                  <Icon name="scissors" size={14} /> Cut
                </button>
                <button className="ctxmenu__item" onClick={() => { openPick('move'); setCtx(null) }}>
                  <Icon name="arrowRight" size={14} /> Move to…
                </button>
                <button className="ctxmenu__item ctxmenu__item--danger" onClick={() => { openDelete(); setCtx(null) }}>
                  <Icon name="trash" size={14} /> Delete
                </button>
                <div className="ctxmenu__sep" />
              </>
            ) : null}
            <button className="ctxmenu__item" onClick={() => { setDialog({ type: 'new' }); setDialogValue(''); setCtx(null) }}>
              <Icon name="folderPlus" size={14} /> New folder
            </button>
            {clip ? (
              <button className="ctxmenu__item" onClick={() => { doPaste(); setCtx(null) }}>
                <Icon name="paste" size={14} /> Paste ({clip.items.length})
              </button>
            ) : null}
            </>
            )}
          </div>
        </>
      ) : null}

      {/* ── Dialogy ── */}
      {dialog && (dialog.type === 'new' || dialog.type === 'rename' || dialog.type === 'delete') ? (
        <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="lib__dialog">
            {dialog.type === 'delete' ? (
              <>
                {config?.deleteMode === 'permanent' ? (
                  <p>
                    Permanently delete {dialog.names.length === 1 ? <strong>{dialog.names[0]}</strong> : `${dialog.names.length} items`}?{' '}
                    {dialog.names.length === 1 ? 'It' : 'They'} won’t go to the {IS_MAC ? 'Trash' : 'Recycle Bin'} and can’t be restored.
                  </p>
                ) : (
                  <p>
                    Move {dialog.names.length === 1 ? <strong>{dialog.names[0]}</strong> : `${dialog.names.length} items`} to the{' '}
                    {IS_MAC ? 'Trash' : 'Recycle Bin'}? You can restore {dialog.names.length === 1 ? 'it' : 'them'} from there.
                  </p>
                )}
                <div className="lib__dialog-foot">
                  <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
                  <button className="btn-primary" autoFocus onClick={() => void confirmDialog()}>Delete</button>
                </div>
              </>
            ) : (
              <>
                <p>{dialog.type === 'new' ? 'New folder name' : 'Rename to'}</p>
                <input
                  autoFocus
                  value={dialogValue}
                  onChange={(e) => setDialogValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      if (dialogValue.trim()) void confirmDialog()
                    }
                  }}
                />
                <div className="lib__dialog-foot">
                  <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
                  <button className="btn-primary" disabled={!dialogValue.trim()} onClick={() => void confirmDialog()}>OK</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {dialog?.type === 'bulkRename' ? (
        <BulkRenameDialog
          items={bulkItems(dialog.names)}
          siblings={entries.map((e) => e.name)}
          cwd={cwd}
          defaultTemplate={config?.folderTemplate || '{artist} - {title}'}
          onClose={() => setDialog(null)}
          onDone={bulkDone}
        />
      ) : null}
      {dialog?.type === 'pick' ? (
        <FolderPickerDialog
          items={
            dialog.base !== undefined
              ? dialog.names.map((n) => ({ name: n, rel: relIn(dialog.base, n), isSong: false, isSng: false, info: undefined }))
              : bulkItems(dialog.names)
          }
          mode={dialog.mode}
          // Z další složky (archivu) míří Copy to… / Move to… do Songs.
          startAt={inExt ? '' : cwd}
          sourceDir={dialog.base ?? cwd}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            if (m && dialog.base !== undefined && dialog.mode === 'move') sideAffect.current = relIn(dialog.base, dialog.names[0])
            bulkDone(m)
          }}
        />
      ) : null}
      {metaFor ? (
        <SongMetaDialog
          rel={metaFor.rel}
          title={metaFor.title}
          onClose={() => setMetaFor(null)}
          onSaved={() => {
            allInfos.delete(metaFor.rel)
            void load(cwd, true)
          }}
        />
      ) : null}
      {existingDialog}
      {playlistFor ? <PlaylistDialog rels={playlistFor} onClose={() => setPlaylistFor(null)} /> : null}

      {toast ? <div className="lv__toast" role="status">{toast}</div> : null}
    </div>
  )
}

/** Texty k rozbité složce podle toho, co v ní chybí. */
const PROBLEM: Record<LibProblem, { badge: string; sub: string; hint: string; head: string; body: JSX.Element }> = {
  chart: {
    badge: 'Missing chart',
    sub: 'Audio only, no chart file · Clone Hero won’t load it',
    hint: 'This folder has audio but no chart file (notes.mid or notes.chart), so Clone Hero won’t load it.',
    head: 'Missing chart file.',
    body: (
      <>
        This folder has the song’s audio but no <code>notes.mid</code> or <code>notes.chart</code>, so Clone
        Hero won’t load it. It’s usually an unfinished conversion.
      </>
    )
  },
  audio: {
    badge: 'Missing audio',
    sub: 'Chart only, no audio files · Clone Hero can’t play it',
    hint: 'This folder has a chart but no audio files (song.ogg, guitar.ogg, …), so Clone Hero can’t play it.',
    head: 'Missing audio.',
    body: (
      <>
        This folder has the chart but no audio files (like <code>song.ogg</code> or <code>guitar.ogg</code>), so
        Clone Hero can’t play it. It’s usually an interrupted download or copy.
      </>
    )
  },
  both: {
    badge: 'Missing chart & audio',
    sub: 'Only song.ini, no chart or audio · Clone Hero won’t load it',
    hint: 'This folder has only song.ini, with no chart file and no audio, so Clone Hero won’t load it.',
    head: 'Missing chart and audio.',
    body: (
      <>
        This folder only has <code>song.ini</code>. The chart (<code>notes.mid</code> or{' '}
        <code>notes.chart</code>) and the audio files are both missing, so Clone Hero won’t load it.
      </>
    )
  }
}
/** Interpret a název z názvu rozbité složky („Artist - Title (RB3 Version)"). */
const fixQuery = songFromFolderName
const problemOf = (it: Item): (typeof PROBLEM)[LibProblem] => PROBLEM[it.e.problem ?? 'chart']

interface RowHandlers {
  click: (name: string, e: React.MouseEvent) => void
  open: (it: Item) => void
  ctx: (name: string, e: React.MouseEvent) => void
  select: (name: string) => void
  check: (name: string) => void
  observe: (el: HTMLElement | null) => void
  fix: (it: Item) => void
  filterBy: (artist: string, album?: string) => void
  filterCharter: (charter: string) => void
}

const LibRow = memo(function LibRow({
  it,
  view,
  info,
  levels,
  thumb,
  count,
  checked,
  focused,
  cut,
  h
}: {
  it: Item
  view: 'cards' | 'list'
  info: LibSongInfo | undefined
  levels: string | undefined
  thumb: string | null | undefined
  count: number | undefined
  checked: boolean
  focused: boolean
  cut: boolean
  h: RowHandlers
}): JSX.Element {
  const cls = `lvrow ${focused ? 'lvrow--focus song--selected' : ''} ${checked ? 'song--checked lvrow--checked' : ''} ${cut ? 'lvrow--cut' : ''}`
  const check = (
    <div className="song__check">
      <label
        className="chk"
        onClick={(e) => {
          e.stopPropagation()
          // Shift+klik na políčko = rozsah, stejně jako Shift+klik na řádek.
          if (e.shiftKey) {
            e.preventDefault()
            h.click(it.name, e)
          }
        }}
      >
        <input type="checkbox" checked={checked} onChange={() => h.check(it.name)} aria-label={`Select ${it.name}`} />
        <span className="chk__box">
          <Icon name="check" size={12} />
        </span>
      </label>
    </div>
  )
  const common = {
    onClick: (e: React.MouseEvent) => h.click(it.name, e),
    // Rychlé klikání na tlačítka v kartě (tři tečky, přehrát, zaškrtnout) se
    // nesmí slít do dvojkliku na kartu, ten by spustil přehrávač.
    onDoubleClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, label, input, a')) return
      h.open(it)
    },
    onContextMenu: (e: React.MouseEvent) => h.ctx(it.name, e),
    onMouseDown: (e: React.MouseEvent) => e.shiftKey && e.preventDefault()
  }

  if (view === 'list') {
    return (
      <div className={`lvli ${cls} ${it.kind === 'broken' ? 'lvli--broken' : ''}`} {...common}>
        {check}
        <Icon
          name={it.kind === 'broken' ? 'alert' : it.e.type === 'dir' ? 'folder' : it.isSng ? 'note' : 'file'}
          size={17}
          color={it.kind === 'song' ? 'var(--accent)' : undefined}
          className={it.kind !== 'broken' && it.e.type === 'dir' ? 'lvfolder-ico' : undefined}
        />
        <span className="lvli__name">
          {it.dir ? <span className="lvli__dir">{it.dir}/</span> : null}
          {it.label}
        </span>
        {it.kind === 'broken' ? (
          <span className="lib__tag lvtag-broken" title={problemOf(it).hint}>
            {problemOf(it).badge.toLowerCase()}
          </span>
        ) : it.kind === 'song' ? (
          <span className="lib__tag">song</span>
        ) : it.kind === 'folder' ? (
          count && count > 0 ? (
            <span className="lib__tag lib__tag--count">
              {count} {count === 1 ? 'song' : 'songs'}
            </span>
          ) : (
            <span className="lib__tag lib__tag--dir">folder</span>
          )
        ) : (
          <span />
        )}
      </div>
    )
  }

  if (it.kind === 'broken') {
    return (
      <div className={`song lvcard lvcard--plain lvcard--broken ${cls}`} {...common} title={problemOf(it).hint}>
        {check}
        <div className="song__art lvart-icon lvart-broken">
          <Icon name="alert" size={26} />
        </div>
        <div className="song__main">
          <div className="song__title" title={it.name}>
            {it.label}
          </div>
          <div className="song__artist lvbroken-sub">
            {problemOf(it).sub}
            {it.dir ? <span className="lvbroken-dir"> · in {it.dir}</span> : null}
          </div>
        </div>
        <div className="lvbroken-cell">
          <span className="lvbroken-badge">
            <Icon name="alert" size={13} /> {problemOf(it).badge}
          </span>
          <button
            type="button"
            className="lvfix"
            title="Search the database for this song and replace the folder with a fresh download"
            onClick={(e) => {
              e.stopPropagation()
              h.fix(it)
            }}
          >
            Fix it
          </button>
        </div>
        <span />
        <button className="lvkebab" type="button" aria-label="More actions" onClick={(e) => h.ctx(it.name, e)}>
          <Icon name="more" size={16} />
        </button>
      </div>
    )
  }

  if (it.kind !== 'song') {
    return (
      <div className={`song lvcard lvcard--plain ${cls}`} {...common}>
        {check}
        <div className="song__art lvart-icon">
          <Icon name={it.kind === 'folder' ? 'folder' : 'file'} size={24} className={it.kind === 'folder' ? 'lvfolder-ico' : undefined} />
        </div>
        <div className="song__main">
          <div className="song__title" title={it.name}>
            {it.name}
          </div>
          <div className="song__artist">
            {it.kind === 'folder' ? (count === undefined ? 'Folder' : `${count} ${count === 1 ? 'song' : 'songs'}`) : 'File'}
          </div>
        </div>
        <span />
        <span />
        <button className="lvkebab" type="button" aria-label="More actions" onClick={(e) => h.ctx(it.name, e)}>
          <Icon name="more" size={16} />
        </button>
      </div>
    )
  }

  const title = info?.title ? info.title : it.name
  return (
    <div className={`song lvcard ${cls}`} data-thumb={it.isSng ? undefined : it.rel} ref={h.observe} {...common}>
      {check}
      <div
        className="song__art"
        onClickCapture={(e) => {
          // Spuštění preview z obalu = zároveň výběr písně (ukáže se v pravém panelu).
          if ((e.target as HTMLElement).closest('.song__preview')) h.select(it.name)
        }}
      >
        {thumb ? (
          <img src={thumb} alt="" draggable={false} />
        ) : (
          <div className={`lvart-none ${thumb === undefined && !it.isSng ? 'lvart-none--loading' : ''}`}>
            <Icon name="note" size={20} />
          </div>
        )}
        {!it.isSng ? <LocalPreview previewKey={`lib:${it.rel}`} rel={it.rel} /> : null}
      </div>
      <div className="song__main">
        <div className="song__title" title={stripTags(title)}>
          <RichText text={title} />
        </div>
        <div className="song__artist">
          {info?.artist ? (
            <button
              type="button"
              className="song__artistlink"
              title={`Show songs by ${stripTags(info.artist)} in this folder`}
              onClick={(e) => {
                e.stopPropagation()
                h.filterBy(info.artist)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <RichText text={info.artist} />
            </button>
          ) : (
            <span className="lvdim">{it.dir ? `${it.dir}/${it.label}` : it.name}</span>
          )}
          {info?.album ? (
            <span className="song__album">
              {' - '}
              <button
                type="button"
                className="song__artistlink"
                title={info.artist ? `Show songs from ${stripTags(info.album)} by ${stripTags(info.artist)} in this folder` : undefined}
                disabled={!info.artist}
                onClick={(e) => {
                  e.stopPropagation()
                  h.filterBy(info.artist, info.album)
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {stripTags(info.album)}
              </button>
            </span>
          ) : null}
          {info?.year ? <span className="song__year"> · {info.year}</span> : null}
        </div>
        <div className="song__meta">
          {info?.lengthSeconds ? <span className="badge badge--len">{formatLength(info.lengthSeconds)}</span> : null}
          <LevelsBadge levels={levels} />
          {it.isSng ? <span className="badge badge--native">.sng</span> : null}
          {info?.charter ? (
            <span className="song__charter">
              <Icon name="charter" size={12} />{' '}
              <button
                type="button"
                className="song__artistlink"
                title={`Show songs charted by ${stripTags(info.charter)} in this folder`}
                onClick={(e) => {
                  e.stopPropagation()
                  h.filterCharter(info.charter)
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <RichText text={info.charter} />
              </button>
            </span>
          ) : null}
        </div>
      </div>
      <div className="song__diffs">
        <InstrumentDifficulty difficulties={info?.difficulties ?? {}} />
      </div>
      <span />
      <button className="lvkebab" type="button" aria-label="More actions" onClick={(e) => h.ctx(it.name, e)}>
        <Icon name="more" size={16} />
      </button>
    </div>
  )
})

function DetailPanel({
  it,
  info,
  levels,
  detail,
  count,
  onOpen,
  onPlay,
  onMeta,
  onReveal,
  onDelete,
  onFix,
  onUnpack,
  onPlaylist,
  onRename,
  onMove,
  onCopy
}: {
  it: Item
  info: LibSongInfo | undefined
  levels: string | undefined
  detail: SongDetail | null
  count: number | undefined
  onOpen: () => void
  onPlay: () => void
  onMeta: () => void
  onReveal: () => void
  onDelete: () => void
  onFix: () => void
  onUnpack?: () => void
  onPlaylist?: () => void
  onRename: () => void
  onMove: () => void
  onCopy: () => void
}): JSX.Element {
  const manage = { onPlaylist, onUnpack, onRename, onMove, onCopy, onDelete }
  if (it.kind === 'broken') {
    return (
      <div className="lv__dsong">
        <div className="lv__dart lv__dart--none lvart-broken">
          <Icon name="alert" size={52} />
        </div>
        <div className="lv__dtitle">{it.name}</div>
        <div className="lvbroken-note">
          <strong>{problemOf(it).head}</strong> {problemOf(it).body} Download the chart again, or delete the
          folder.
        </div>
        <div className="lv__dactions">
          <button className="btn-primary lvfix-detail" onClick={onFix} title="Search the database for this song and replace the folder with a fresh download">
            <Icon name="download" size={13} /> Fix it
          </button>
          <button className="btn-secondary" onClick={onOpen}>Open folder</button>
          <button className="btn-secondary" onClick={onReveal}>{IS_MAC ? 'Show in Finder' : 'Show in Explorer'}</button>
          <button className="btn-secondary lv__danger" onClick={onDelete}>
            <Icon name="trash" size={13} /> Delete folder
          </button>
        </div>
      </div>
    )
  }
  if (it.kind !== 'song') {
    return (
      <div className="lv__dsong">
        {it.kind === 'folder' ? (
          <FolderCover rel={it.rel} />
        ) : (
          <div className="lv__dart lv__dart--none">
            <Icon name="file" size={48} />
          </div>
        )}
        <div className="lv__dtitle">{it.name}</div>
        <div className="lv__dsub">
          {it.kind === 'folder' ? (count === undefined ? 'Folder' : `${count} ${count === 1 ? 'song' : 'songs'}`) : 'File'}
        </div>
        <div className="lv__dlabel">{it.kind === 'folder' ? 'Folder' : 'File'}</div>
        <PanelActions
          {...manage}
          primary={it.kind === 'folder' ? { label: 'Open folder', icon: 'folder', onClick: onOpen } : undefined}
          onPlay={it.kind === 'folder' ? onPlay : undefined}
          playLabel="Listen in music player"
          onReveal={onReveal}
        />
      </div>
    )
  }
  const d = detail?.info ?? info
  return (
    <div className="lv__dsong">
      <div className="lv__dartwrap song__art">
        {detail?.albumArt ? (
          <img className="lv__dart" src={detail.albumArt} alt="" />
        ) : (
          <div className="lv__dart lv__dart--none">
            <Icon name="note" size={42} />
          </div>
        )}
        {!it.isSng ? <LocalPreview previewKey={`libd:${it.rel}`} rel={it.rel} size={22} /> : null}
      </div>
      <SongSummary info={d ?? undefined} levels={levels} fallback={it.name} />
      <div className="lv__dlabel">Song</div>
      <PanelActions
        {...manage}
        onPlay={it.isSng ? undefined : onPlay}
        onMeta={it.isSng ? undefined : onMeta}
        onReveal={onReveal}
      />
      <dl className="lv__dkv">
        <dt>Folder</dt>
        <dd className="lv__dpath">{it.rel}</dd>
      </dl>
    </div>
  )
}

/**
 * Koláž obalů písní ve složce (jako u setlistu). Bere písně přímo ve složce,
 * a když tam žádné nejsou, i z několika podsložek. Stejné obaly (písně z jednoho
 * alba) se v koláži neopakují. Čtyři a víc obalů = mřížka 2×2, jinak jeden.
 */
function FolderCover({ rel }: { rel: string }): JSX.Element {
  const [arts, setArts] = useState<string[] | null>(() => folderCoverCache.get(rel) ?? null)
  useEffect(() => {
    const hit = folderCoverCache.get(rel)
    setArts(hit ?? null)
    if (hit) return
    let alive = true
    const songsOf = (l: LibListing): string[] =>
      l.entries.filter((e) => e.type === 'dir' && e.isSong).map((e) => `${l.path}/${e.name}`)
    void (async () => {
      try {
        const top = await window.api.libList(rel)
        const rels = songsOf(top)
        if (!rels.length) {
          for (const d of top.entries.filter((e) => e.type === 'dir' && !e.isSong).slice(0, 8)) {
            rels.push(...songsOf(await window.api.libList(`${top.path}/${d.name}`)))
            if (rels.length >= 24 || !alive) break
          }
        }
        const pick = rels.slice(0, 24)
        // Do sdílené thumbCache se NEzapisuje: karty podle ní poznají, že obal už
        // mají ve stavu, a znovu si ho nevyžádají (zůstaly by bez obalu).
        const got = new Map<string, string | null>()
        for (const r of pick) if (thumbCache.has(r)) got.set(r, thumbCache.get(r) ?? null)
        const missing = pick.filter((r) => !got.has(r))
        if (missing.length) {
          const t = await window.api.libAlbumThumbs(missing)
          for (const [r, v] of Object.entries(t)) got.set(r, v)
        }
        const uniq = [...new Set(pick.map((r) => got.get(r)).filter((t): t is string => !!t))].slice(0, 4)
        folderCoverCache.set(rel, uniq)
        if (alive) setArts(uniq)
      } catch {
        if (alive) setArts([])
      }
    })()
    return () => {
      alive = false
    }
  }, [rel])
  const shown = arts && arts.length >= 4 ? arts : arts?.slice(0, 1) ?? []
  if (!shown.length) {
    return (
      <div className="lv__dart lv__dart--none">
        <Icon name="folder" size={48} />
      </div>
    )
  }
  return (
    <div className={`lv__dart lv__fcover ${shown.length >= 4 ? 'lv__fcover--grid' : ''}`} aria-hidden="true">
      {shown.map((t, i) => (
        <img key={i} src={t} alt="" />
      ))}
    </div>
  )
}

/** Šipka směru řazení v záhlaví; místo drží i vypnutá, ať popisky neposkakují. */
function SortArrow({ on, dir }: { on: boolean; dir: 1 | -1 }): JSX.Element {
  return (
    <span className={`lvsort ${on ? 'lvsort--on' : ''}`} aria-hidden="true">
      <Icon name="caret" size={10} style={{ transform: dir === 1 ? 'rotate(180deg)' : 'none' }} />
    </span>
  )
}

// Větší obaly pro stoh ve výběru (sdílené mezi výběry, ať se nenačítají znovu).
const coverCache = new Map<string, string | null>()
const coverInflight = new Set<string>()
const STACK_DEPTH = 4
const STACK_CARD = 72 // šířka obalu v % šířky stohu (musí sedět s .lvstack__card)

/**
 * Stoh obalů vybraných písní. Vidět jsou první čtyři, kolečko myši nad
 * stohem jimi točí dokola (bez konce); obaly se dotahují jen kolem aktuální
 * pozice. Přední obal má stejné tlačítko ukázky jako detail jedné písně.
 */
function CoverStack({ items, infos }: { items: Item[]; infos: Record<string, LibSongInfo> }): JSX.Element {
  // pos roste/klesá bez omezení, aktuální index je pos mod n.
  const [pos, setPos] = useState(0)
  const [, bump] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const n = items.length
  const at = n ? ((pos % n) + n) % n : 0
  const idx = (k: number): number => (((at + k) % n) + n) % n

  // Vrstvy k = 0 … DEPTH (poslední je neviditelná rezerva, ze které se vysune
  // další obal) a k = −1 (právě odjetý obal). Při malém výběru by se stejná
  // píseň objevila dvakrát, takže každý index bereme jen jednou.
  const layers: { k: number; it: Item }[] = []
  if (n) {
    const used = new Set<number>()
    for (const k of [...Array.from({ length: STACK_DEPTH + 1 }, (_, j) => j), -1]) {
      const j = idx(k)
      if (used.has(j)) continue
      used.add(j)
      layers.push({ k, it: items[j] })
    }
  }

  const want = n
    ? [...new Set(Array.from({ length: STACK_DEPTH + 4 }, (_, j) => items[idx(j - 1)].rel))].filter(
        (r) => !coverCache.has(r) && !coverInflight.has(r)
      )
    : []
  const wantKey = want.join('|')
  useEffect(() => {
    if (!want.length) return
    want.forEach((r) => coverInflight.add(r))
    void window.api
      .libAlbumCovers(want)
      .then((res) => {
        for (const [k, v] of Object.entries(res)) coverCache.set(k, v)
      })
      .finally(() => {
        want.forEach((r) => coverInflight.delete(r))
        bump((x) => x + 1)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey])

  useEffect(() => {
    const el = ref.current
    if (!el || n < 2) return
    let acc = 0
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) < 40) return
      const step = acc > 0 ? 1 : -1
      acc = 0
      setPos((p) => p + step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [n])

  if (!n) {
    return (
      <div className="lv__dart lv__dart--none">
        <Icon name="copy" size={42} />
      </div>
    )
  }
  const front = items[at]
  const info = infos[front.rel]
  // Vycentrování celého stohu: obal má 72 % šířky, každá další vrstva ho
  // posune o 12 % doprava a 10 % nahoru a zmenší o 7 %.
  const m = Math.min(STACK_DEPTH, n) - 1
  const left = `${(100 - STACK_CARD * (1 + 0.05 * m)) / 2}%`
  const bottom = `${(100 - STACK_CARD * (1 + 0.03 * m)) / 2}%`
  return (
    <div className="lvstack-wrap">
      <div ref={ref} className="lvstack" title={n > 1 ? 'Scroll to browse the selected songs' : undefined}>
        {layers.map(({ k, it }) => {
          const hidden = k < 0 || k >= STACK_DEPTH
          const src = coverCache.get(it.rel)
          return (
            <div
              key={it.rel}
              className={`lvstack__card song__art ${k === 0 ? 'lvstack__card--front' : ''}`}
              title={k > 0 && !hidden ? 'Bring to front' : undefined}
              // Zadní obal se klikem přesune dopředu; přední řeší tlačítko ukázky.
              onClick={k > 0 && !hidden ? () => setPos((p) => p + k) : undefined}
              style={{
                pointerEvents: hidden ? 'none' : undefined,
                left,
                bottom,
                zIndex: 20 - k,
                opacity: hidden ? 0 : 1,
                transform:
                  k < 0
                    ? 'translate(-18%, 14%) rotateY(-12deg) scale(1.04)'
                    : `translate(${k * 12}%, ${-k * 10}%) rotateY(-12deg) scale(${1 - k * 0.07})`,
                filter: `brightness(${1 - Math.max(0, Math.min(k, STACK_DEPTH)) * 0.17})`
              }}
            >
              {src ? (
                <img src={src} alt="" draggable={false} />
              ) : (
                <div className={`lvstack__none ${src === undefined ? 'lvart-none--loading' : ''}`}>
                  <Icon name="note" size={34} />
                </div>
              )}
              {k === 0 && !it.isSng ? <LocalPreview previewKey={`libs:${it.rel}`} rel={it.rel} size={22} /> : null}
            </div>
          )
        })}
      </div>
      <SongSummary info={info} fallback={front.name} count={n > 1 ? `${at + 1} / ${n}` : undefined} />
    </div>
  )
}

/** Údaje o písni v pravém panelu, stejně u jedné písně i u stohu výběru. */
function SongSummary({
  info,
  levels,
  fallback,
  count
}: {
  info: LibSongInfo | undefined
  levels?: string
  fallback: string
  count?: string
}): JSX.Element {
  const sub = [info?.album ? stripTags(info.album) : null, info?.year || null, info?.genre ? stripTags(info.genre) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="lvsum">
      <div className="lvsum__head">
        <div className="lv__dtitle">{info?.title ? <RichText text={info.title} /> : fallback}</div>
        {count ? <span className="lvstack__count">{count}</span> : null}
      </div>
      {info?.artist ? (
        <div className="lv__dartist">
          <RichText text={info.artist} />
        </div>
      ) : null}
      {sub ? <div className="lv__dsub">{sub}</div> : null}
      {info?.charter || info?.lengthSeconds || levels ? (
        <div className="lvsum__meta">
          {info?.lengthSeconds ? <span className="badge badge--len">{formatLength(info.lengthSeconds)}</span> : null}
          <LevelsBadge levels={levels} />
          {info?.charter ? (
            <span className="song__charter">
              <Icon name="charter" size={12} /> <RichText text={info.charter} />
            </span>
          ) : null}
        </div>
      ) : null}
      {info ? (
        <div className="lv__ddiffs">
          <InstrumentDifficulty difficulties={info.difficulties} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Tlačítka pravého panelu ve stejném pořadí pro jednu položku i výběr:
 * hlavní akce, Add to setlist, pak správa souborů ve dvou sloupcích.
 */
function PanelActions({
  primary,
  onPlay,
  playLabel = 'Play in music player',
  onPlaylist,
  onUnpack,
  unpackLabel = 'Unpack .sng into a folder',
  onMeta,
  onReveal,
  onRename,
  onMove,
  onCopy,
  onDelete
}: {
  primary?: { label: string; icon: IconName; onClick: () => void }
  onPlay?: () => void
  playLabel?: string
  onPlaylist?: () => void
  onUnpack?: () => void
  unpackLabel?: string
  onMeta?: () => void
  onReveal?: () => void
  onRename: () => void
  onMove: () => void
  onCopy: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="lv__dactions">
      {primary ? (
        <button className="btn-primary" onClick={primary.onClick}>
          <Icon name={primary.icon} size={13} /> {primary.label}
        </button>
      ) : null}
      {onPlay ? (
        <button className={primary ? 'btn-secondary' : 'btn-primary'} onClick={onPlay}>
          <Icon name="play" size={13} /> {playLabel}
        </button>
      ) : null}
      {onPlaylist ? (
        <button className="btn-secondary" onClick={onPlaylist}>
          <Icon name="note" size={13} /> Add to setlist
        </button>
      ) : null}
      {onUnpack ? (
        <button
          className="btn-secondary"
          onClick={onUnpack}
          title="Unpack into a normal song folder, the same as a Song folder download. The .sng file is then deleted."
        >
          <Icon name="folder" size={13} /> {unpackLabel}
        </button>
      ) : null}
      <div className="lv__dactions--grid">
        {onMeta ? <button className="btn-secondary" onClick={onMeta}>Edit metadata</button> : null}
        {onReveal ? (
          <button className="btn-secondary" onClick={onReveal}>
            {IS_MAC ? 'Show in Finder' : 'Show in Explorer'}
          </button>
        ) : null}
        <button className="btn-secondary" onClick={onRename}>Rename…</button>
        <button className="btn-secondary" onClick={onMove}>Move to…</button>
        <button className="btn-secondary" onClick={onCopy}>Copy to…</button>
        <button className="btn-secondary lv__danger" onClick={onDelete}>
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>
    </div>
  )
}

/**
 * Název složky ve stromu: když se nevejde, po najetí myší na položku se
 * pomalu posune, aby byl vidět celý (a zase zpět). Krátké názvy stojí.
 */
function ScrollName({ text }: { text: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const box = ref.current
    const item = box?.closest('.lv__titem')
    const inner = box?.firstElementChild as HTMLElement | null
    if (!box || !item || !inner) return
    const enter = (): void => {
      // Vnitřní span je inline (kvůli „…"), scrollWidth má 0 — šířka z rectu.
      const over = inner.getBoundingClientRect().width - box.getBoundingClientRect().width
      if (over <= 2) return
      box.style.setProperty('--lv-shift', `-${over + 4}px`)
      // ~35 px za sekundu, ať se dá číst; aspoň 1,5 s na jednu stranu.
      box.style.setProperty('--lv-dur', `${Math.max(1.5, over / 35).toFixed(2)}s`)
      box.classList.add('lv__tname--run')
    }
    const leave = (): void => box.classList.remove('lv__tname--run')
    item.addEventListener('mouseenter', enter)
    item.addEventListener('mouseleave', leave)
    return () => {
      item.removeEventListener('mouseenter', enter)
      item.removeEventListener('mouseleave', leave)
    }
  }, [text])
  return (
    <span ref={ref} className="lv__tname">
      <span className="lv__tname-in">{text}</span>
    </span>
  )
}
