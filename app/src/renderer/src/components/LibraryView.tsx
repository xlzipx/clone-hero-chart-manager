import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { InstrumentDifficulties, LibEntry, LibSongInfo, SongDetail } from '../../../shared/types'
import { errMsg } from '../../../shared/errors'
import { IS_MAC } from '../platform'
import { useStore } from '../store'
import { formatLength, INSTRUMENTS, stripTags } from '../utils'
import { RichText } from './RichText'
import { LocalPreview } from './LocalPreview'
import { DuplicatesModal } from './DuplicatesModal'
import { Icon } from './Icon'
import { InstrumentDifficulty } from './InstrumentDifficulty'
import { PlaylistDialog } from './PlaylistDialog'
import { PlaylistManagerModal } from './PlaylistManagerModal'
import { SongMetaDialog } from './SongMetaDialog'
import { BulkRenameDialog, FolderPickerDialog, type BulkItem } from './LibraryDialogs'

/** broken = složka s audiem, ale bez souboru s notami (Clone Hero ji nenačte). */
type Kind = 'folder' | 'song' | 'broken' | 'file'
interface Item {
  e: LibEntry
  name: string
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

const SORTS: { id: SortKey; label: string; group: 'Song' | 'Difficulty' | 'File' }[] = [
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
  ...INSTRUMENTS.map((i) => ({ id: `d:${i.id}` as SortKey, label: `${i.label} difficulty`, group: 'Difficulty' as const })),
  { id: 'dmax', label: 'Hardest instrument', group: 'Difficulty' }
]
// Čísla (rok, délka, obtížnost, data) se řadí od nejvyšší hodnoty, texty od A.
const DESC_FIRST = new Set<SortKey>(['year', 'length', 'songs', 'modified', 'created', 'dmax', ...INSTRUMENTS.map((i) => `d:${i.id}` as SortKey)])

interface Filters {
  inst: InstId[]
  min: number
  max: number
  charter: string
  /** Jen složky, kterým chybí soubor s notami. */
  broken: boolean
}
const NO_FILTERS: Filters = { inst: [], min: 0, max: 6, charter: '', broken: false }

type Dialog =
  | { type: 'new' }
  | { type: 'rename'; name: string }
  | { type: 'delete'; names: string[] }
  | { type: 'bulkRename'; names: string[] }
  | { type: 'pick'; mode: 'move' | 'copy'; names: string[] }
  | null
type Clip = { op: 'cut' | 'copy'; items: string[]; names: string[] } | null
type Ctx = { x: number; y: number } | null

// Mezi přepnutími Search ↔ Library si pamatujeme otevřenou složku a náhledy.
let lastCwd = ''
const thumbCache = new Map<string, string | null>()

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

  const [cwd, setCwd] = useState(lastCwd)
  const [entries, setEntries] = useState<LibEntry[]>([])
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  const [infos, setInfos] = useState<Record<string, LibSongInfo>>({})
  const [infoLoading, setInfoLoading] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>(() => Object.fromEntries(thumbCache))
  const [rootDirs, setRootDirs] = useState<LibEntry[]>([])
  const [rootCounts, setRootCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'cards' | 'list'>(config?.libraryView ?? 'cards')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [focus, setFocus] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [clip, setClip] = useState<Clip>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [ctx, setCtx] = useState<Ctx>(null)
  const [metaFor, setMetaFor] = useState<{ rel: string; title: string } | null>(null)
  const [playlistFor, setPlaylistFor] = useState<string[] | null>(null)
  const [dupOpen, setDupOpen] = useState(false)
  const [plmOpen, setPlmOpen] = useState(false)
  const [detail, setDetail] = useState<SongDetail | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [revealActive, setRevealActive] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
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
  const countsCache = useRef<Map<string, Record<string, number>>>(new Map())

  const relOf = useCallback((name: string): string => (cwd ? `${cwd}/${name}` : name), [cwd])
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  const anyDialog = dialog !== null || metaFor !== null || playlistFor !== null || dupOpen || plmOpen

  // ── Načtení složky ────────────────────────────────────────────────
  const loadInfos = async (path: string, list: LibEntry[], my: number): Promise<void> => {
    const rels = list
      .filter((e) => e.type === 'dir' && e.isSong)
      .map((e) => (path ? `${path}/${e.name}` : e.name))
    const sngs = list.filter((e) => e.type === 'file' && /\.sng$/i.test(e.name))
    const base: Record<string, LibSongInfo> = {}
    for (const s of sngs) {
      const rel = path ? `${path}/${s.name}` : s.name
      base[rel] = sngInfo(rel, s.name)
    }
    setInfos(base)
    if (!rels.length) return
    setInfoLoading(true)
    // Metadata jen ze song.ini (levné) pro CELOU složku, po dávkách — bez nich by
    // nešlo řadit ani filtrovat podle obtížnosti. Obaly se čtou zvlášť a líně.
    for (let i = 0; i < rels.length; i += 80) {
      const chunk = rels.slice(i, i + 80)
      let got: LibSongInfo[] = []
      try {
        got = await window.api.libSongInfo(chunk)
      } catch {
        /* chybějící metadata = karta jen s názvem složky */
      }
      if (my !== loadSeq.current) return
      setInfos((prev) => {
        const next = { ...prev }
        for (const g of got) next[g.rel] = g
        return next
      })
    }
    if (my === loadSeq.current) setInfoLoading(false)
  }

  const loadTree = (): void => {
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
      void loadInfos(res.path, res.entries, my)
    } catch (e) {
      if (my !== loadSeq.current) return
      setError(errMsg(e))
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
        listRef.current?.querySelector('.lvrow--focus')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 80)
    }
  }

  useEffect(() => {
    loadTree()
    const targets = useStore.getState().libraryReveal
    if (targets && targets.length) void revealTarget(targets[0])
    else void load(lastCwd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // „In library" z hledání, když je Library už otevřená.
  useEffect(() => {
    if (libraryReveal && libraryReveal.length) void revealTarget(libraryReveal[0])
    else setRevealActive(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReveal])

  const run = async (fn: () => Promise<void>, okMsg?: string): Promise<void> => {
    try {
      setError(null)
      await fn()
      if (okMsg) showToast(okMsg)
    } catch (e) {
      setError(errMsg(e))
    }
    await load(cwd, true)
    loadTree()
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const showToast = (msg: string): void => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  // ── Položky: druh, filtr, řazení ─────────────────────────────────
  const items: Item[] = useMemo(
    () =>
      entries.map((e) => {
        const rel = cwd ? `${cwd}/${e.name}` : e.name
        const isSng = e.type === 'file' && /\.sng$/i.test(e.name)
        const kind: Kind =
          e.type === 'dir' ? (e.isSong ? 'song' : e.incomplete ? 'broken' : 'folder') : isSng ? 'song' : 'file'
        return { e, name: e.name, rel, kind, isSng }
      }),
    [entries, cwd]
  )

  const metaFilter = filters.inst.length > 0 || filters.min > 0 || filters.max < 6 || !!filters.charter.trim()
  const activeFilterCount =
    filters.inst.length +
    (filters.min > 0 || filters.max < 6 ? 1 : 0) +
    (filters.charter.trim() ? 1 : 0) +
    (filters.broken ? 1 : 0)
  const brokenCount = items.filter((i) => i.kind === 'broken').length

  const visible: Item[] = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const ch = filters.charter.trim().toLowerCase()
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
    return list.sort((a, b) => {
      // Složky vždy nahoře, pak písně, pak ostatní soubory — nezávisle na směru.
      const g = group(a) - group(b)
      if (g) return g
      const va = val(a)
      const vb = val(b)
      // Chybějící hodnota (nenacharovaný nástroj, žádný rok…) vždy na konec.
      if (va === undefined && vb !== undefined) return 1
      if (vb === undefined && va !== undefined) return -1
      if (va !== undefined && vb !== undefined) {
        const c =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true })
        if (c) return c * sortDir
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    })
  }, [items, infos, q, filters, metaFilter, sortKey, sortDir, folderCounts])

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

  const setSort = (k: SortKey): void => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(k)
      setSortDir(DESC_FIRST.has(k) ? -1 : 1)
    }
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
  const allChecked = visible.length > 0 && visible.every((i) => checked.has(i.name))
  const someChecked = !allChecked && visible.some((i) => checked.has(i.name))
  const toggleAll = (): void => setChecked(allChecked ? new Set() : new Set(visible.map((i) => i.name)))

  const rowClick = (name: string, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) toggleCheck(name)
    else if (e.shiftKey && anchor) {
      const names = visible.map((i) => i.name)
      const a = names.indexOf(anchor)
      const b = names.indexOf(name)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setChecked(new Set(names.slice(lo, hi + 1)))
      }
    } else {
      setFocus(name)
      setAnchor(name)
    }
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
  const h = useRef({ rowClick, rowOpen, rowCtx, toggleCheck, observe })
  h.current = { rowClick, rowOpen, rowCtx, toggleCheck, observe }
  const handlers = useMemo<RowHandlers>(
    () => ({
      click: (n, e) => h.current.rowClick(n, e),
      open: (it) => h.current.rowOpen(it),
      ctx: (n, e) => h.current.rowCtx(n, e),
      check: (n) => h.current.toggleCheck(n),
      observe: (el) => h.current.observe(el)
    }),
    []
  )

  // ── Akce ──────────────────────────────────────────────────────────
  const doCopy = (op: 'cut' | 'copy'): void => {
    const names = targetNames()
    if (names.length) setClip({ op, items: names.map(relOf), names })
  }
  const doPaste = (): void => {
    if (!clip) return
    const c = clip
    void run(async () => {
      for (const item of c.items) {
        if (c.op === 'cut') await window.api.libMove(item, cwd)
        else await window.api.libCopy(item, cwd)
      }
      if (c.op === 'cut') setClip(null)
    })
  }
  const openRename = (): void => {
    const names = targetNames()
    if (names.length === 1) {
      setDialog({ type: 'rename', name: names[0] })
      setDialogValue(names[0])
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
    if (d.type === 'new') await run(() => window.api.libCreateFolder(cwd, dialogValue.trim()))
    else if (d.type === 'rename') await run(() => window.api.libRename(relOf(d.name), dialogValue.trim()))
    else if (d.type === 'delete')
      await run(async () => {
        for (const n of d.names) await window.api.libTrash(relOf(n))
        setChecked(new Set())
        setFocus(null)
      }, `Moved ${d.names.length} item${d.names.length === 1 ? '' : 's'} to the trash`)
  }

  const bulkDone = (msg: string): void => {
    if (msg) {
      setDialog(null)
      setChecked(new Set())
      showToast(msg)
    }
    void load(cwd, !msg)
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
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || anyDialog) return
      const ctrl = e.ctrlKey || e.metaKey
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
    void window.api.setConfig({ libraryView: v })
  }

  // ── Render ────────────────────────────────────────────────────────
  const targets = targetNames()
  const targetSongs = bulkItems(targets).filter((i) => i.isSong && !i.isSng).length
  const single = targets.length === 1 ? items.find((i) => i.name === targets[0]) : undefined
  const songCount = items.filter((i) => i.kind === 'song').length
  const cutSet = new Set(clip && clip.op === 'cut' ? clip.items : [])
  const topFolder = segments[0] ?? ''

  return (
    <div className="lv">
      {/* ── Strom: složky nejvyšší úrovně, playlisty, duplicity ── */}
      <aside className="lv__tree" aria-label="Library folders">
        {/* Nástroje nahoře, ať nejsou pod dlouhým seznamem složek. */}
        <div className="lv__treesec">
          <div className="lv__treelabel">Tools</div>
          <button type="button" className="lv__titem" onClick={() => setPlmOpen(true)}>
            <Icon name="note" size={15} />
            <span className="lv__tname">Playlists</span>
          </button>
          <button type="button" className="lv__titem" onClick={() => setDupOpen(true)}>
            <Icon name="copy" size={15} />
            <span className="lv__tname">Duplicates</span>
          </button>
        </div>
        <div className="lv__treesec">
          <div className="lv__treelabel">Songs</div>
          <button type="button" className={`lv__titem ${cwd === '' ? 'lv__titem--on' : ''}`} onClick={() => void load('')}>
            <Icon name="folder" size={15} />
            <span className="lv__tname">All folders</span>
            <span className="lv__tcount">{rootDirs.length}</span>
          </button>
          {rootDirs.map((d) => (
            <button
              key={d.name}
              type="button"
              className={`lv__titem ${topFolder === d.name ? 'lv__titem--on' : ''}`}
              onClick={() => void load(d.name)}
              title={d.name}
            >
              <Icon name="folder" size={15} />
              <span className="lv__tname">{d.name}</span>
              <span className="lv__tcount">{rootCounts[d.name] ?? ''}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="lv__main" aria-label="Library">
        <div className="lv__bar">
          <button
            className="lib__btn lib__btn--icon"
            onClick={() => void load(segments.slice(0, -1).join('/'))}
            disabled={!cwd}
            title="Up one folder"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <div className="lib__crumbs lv__crumbs" ref={crumbsRef}>
            <button className="crumb" onClick={() => void load('')}>
              <Icon name="folder" size={14} /> Songs
            </button>
            {segments.map((seg, i) => (
              <span key={i} className="crumb__wrap">
                <span className="crumb__sep">/</span>
                <button className="crumb" onClick={() => void load(segments.slice(0, i + 1).join('/'))}>
                  {seg}
                </button>
              </span>
            ))}
          </div>
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
              {(['File', 'Song', 'Difficulty'] as const).map((g) => (
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
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <Icon name="filter" size={14} /> Filters
            {activeFilterCount ? <span className="lv__fcount">{activeFilterCount}</span> : null}
          </button>
          <div className="lv__seg" role="group" aria-label="View">
            <button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => changeView('cards')} title="Cards: album art, difficulties, preview">
              <Icon name="cards" size={15} />
            </button>
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="List: compact">
              <Icon name="list" size={15} />
            </button>
          </div>
          <button className="lib__btn lib__btn--icon" onClick={() => { setDialog({ type: 'new' }); setDialogValue('') }} title="New folder">
            <Icon name="folderPlus" size={15} />
          </button>
          <button className="lib__btn lib__btn--icon" onClick={() => window.api.libOpen(cwd)} title={IS_MAC ? 'Open in Finder' : 'Open in Explorer'}>
            <Icon name="external" size={15} />
          </button>
          <button className="lib__btn lib__btn--icon" onClick={() => { void load(cwd, true); loadTree() }} title="Refresh">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        {filtersOpen ? (
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
              <span className="lv__flabel">Difficulty (tier)</span>
              <div className="lv__range">
                <select
                  className="lib__sortsel"
                  aria-label="Minimum tier"
                  value={filters.min}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setFilters((f) => ({ ...f, min: v, max: Math.max(v, f.max) }))
                  }}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      Tier {n}
                    </option>
                  ))}
                </select>
                <span>to</span>
                <select
                  className="lib__sortsel"
                  aria-label="Maximum tier"
                  value={filters.max}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setFilters((f) => ({ ...f, max: v, min: Math.min(v, f.min) }))
                  }}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      Tier {n}
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
              <span className="lv__flabel">Charter</span>
              <input
                className="lv__finput"
                placeholder="Charter name"
                value={filters.charter}
                onChange={(e) => setFilters((f) => ({ ...f, charter: e.target.value }))}
              />
              <span className="lv__fhint">
                {visible.filter((i) => i.kind === 'song').length} of {songCount} songs match
                {infoLoading ? ' (still reading song details…)' : ''}
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
                  <Icon name="alert" size={14} /> Missing chart{brokenCount ? ` (${brokenCount})` : ''}
                </button>
              </div>
              <button className="lv__link lv__fclear" type="button" disabled={!activeFilterCount} onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            </div>
          </div>
        ) : null}

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
          <div className="lv__bulk">
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
            <button className="lib__btn" disabled={!targetSongs} onClick={openPlaylist}>
              <Icon name="note" size={14} /> Add to playlist
            </button>
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
                {(['title', 'artist', 'album', 'length'] as SortKey[]).map((k) => (
                  <button key={k} type="button" className={sortKey === k ? 'on' : ''} onClick={() => setSort(k)}>
                    {SORTS.find((s) => s.id === k)?.label}
                    {sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                ))}
              </span>
              <span className="lv__hinst">
                {INSTRUMENTS.map((i) => {
                  const k = `d:${i.id}` as SortKey
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className={sortKey === k ? 'on' : ''}
                      title={`Sort by ${i.label} difficulty`}
                      onClick={() => setSort(k)}
                    >
                      <Icon name={i.icon} size={16} color={i.color} />
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
                Name{sortKey === 'name' ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
              </button>
              <span />
            </>
          )}
        </div>

        <div
          ref={listRef}
          className={`lv__list lv__list--${view}`}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault()
              setChecked(new Set())
              setFocus(null)
              setCtx({ x: e.clientX, y: e.clientY })
            }
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              setChecked(new Set())
              setFocus(null)
            }
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
            visible.map((it) => (
              <LibRow
                // Klíč = celá cesta: stejně pojmenovaná píseň v jiné složce musí
                // dostat nový řádek, jinak se pro ni nevyžádá náhled obalu.
                key={it.rel}
                it={it}
                view={view}
                info={infos[it.rel]}
                thumb={thumbs[it.rel]}
                count={it.kind === 'folder' ? folderCounts[it.name] : undefined}
                checked={checked.has(it.name)}
                focused={focus === it.name}
                cut={cutSet.has(it.rel)}
                h={handlers}
              />
            ))
          )}
        </div>

        <div className="lib__actions">
          <span className="lib__selinfo">
            {visible.length === items.length ? `${items.length} items` : `${visible.length} of ${items.length} items`}
            {checked.size ? ` · ${checked.size} selected` : ''}
            {clip ? ` · ${clip.items.length} on clipboard (${clip.op})` : ''}
          </span>
          {brokenCount ? (
            <button
              type="button"
              className={`lv__brokenlink ${filters.broken ? 'lv__brokenlink--on' : ''}`}
              title={filters.broken ? 'Show everything again' : 'Show only folders that are missing a chart file'}
              onClick={() => setFilters((f) => ({ ...f, broken: !f.broken }))}
            >
              <Icon name="alert" size={13} /> {brokenCount} missing a chart
            </button>
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
      <aside className="lv__detail" aria-label="Details">
        {checked.size > 1 ? (
          <div className="lv__dmulti">
            <div className="lv__dart lv__dart--none">
              <Icon name="copy" size={42} />
            </div>
            <div className="lv__dtitle">{checked.size} items selected</div>
            <div className="lv__dsub">Use the bar above the list for bulk actions.</div>
            <div className="lv__dactions">
              <button className="btn-primary" onClick={openRename}>Rename {checked.size} items…</button>
              <button className="btn-secondary" onClick={() => openPick('move')}>Move to…</button>
              <button className="btn-secondary" onClick={() => openPick('copy')}>Copy to…</button>
              <button className="btn-secondary lv__danger" onClick={openDelete}>Delete {checked.size} items</button>
            </div>
          </div>
        ) : focusItem ? (
          <DetailPanel
            it={focusItem}
            info={infos[focusItem.rel]}
            detail={detail}
            count={focusItem.kind === 'folder' ? folderCounts[focusItem.name] : undefined}
            onOpen={() => void load(focusItem.rel)}
            onPlay={() => void playFolder(focusItem.rel, stripTags(infos[focusItem.rel]?.title || focusItem.name))}
            onMeta={() => setMetaFor({ rel: focusItem.rel, title: focusItem.name })}
            onReveal={() => window.api.libReveal(focusItem.rel)}
            onDelete={() => setDialog({ type: 'delete', names: [focusItem.name] })}
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
            {targetSongs > 0 ? (
              <button className="ctxmenu__item" onClick={() => { openPlaylist(); setCtx(null) }}>
                <Icon name="note" size={14} /> Add to playlist ({targetSongs})
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
          </div>
        </>
      ) : null}

      {/* ── Dialogy ── */}
      {dialog && (dialog.type === 'new' || dialog.type === 'rename' || dialog.type === 'delete') ? (
        <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="lib__dialog">
            {dialog.type === 'delete' ? (
              <>
                <p>
                  Move {dialog.names.length === 1 ? <strong>{dialog.names[0]}</strong> : `${dialog.names.length} items`} to the{' '}
                  {IS_MAC ? 'Trash' : 'Recycle Bin'}? You can restore {dialog.names.length === 1 ? 'it' : 'them'} from there.
                </p>
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
          items={bulkItems(dialog.names)}
          mode={dialog.mode}
          startAt={cwd}
          onClose={() => setDialog(null)}
          onDone={bulkDone}
        />
      ) : null}
      {metaFor ? (
        <SongMetaDialog
          rel={metaFor.rel}
          title={metaFor.title}
          onClose={() => setMetaFor(null)}
          onSaved={() => void load(cwd, true)}
        />
      ) : null}
      {playlistFor ? <PlaylistDialog rels={playlistFor} onClose={() => setPlaylistFor(null)} /> : null}
      {dupOpen ? (
        <DuplicatesModal
          onClose={() => setDupOpen(false)}
          onChanged={() => {
            void load(cwd, true)
            loadTree()
          }}
        />
      ) : null}
      {plmOpen ? <PlaylistManagerModal onClose={() => setPlmOpen(false)} /> : null}

      {toast ? <div className="lv__toast" role="status">{toast}</div> : null}
    </div>
  )
}

const BROKEN_HINT =
  'This folder has audio but no chart file (notes.mid or notes.chart), so Clone Hero won’t load it.'

interface RowHandlers {
  click: (name: string, e: React.MouseEvent) => void
  open: (it: Item) => void
  ctx: (name: string, e: React.MouseEvent) => void
  check: (name: string) => void
  observe: (el: HTMLElement | null) => void
}

const LibRow = memo(function LibRow({
  it,
  view,
  info,
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
      <label className="chk" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => h.check(it.name)} aria-label={`Select ${it.name}`} />
        <span className="chk__box">
          <Icon name="check" size={12} />
        </span>
      </label>
    </div>
  )
  const common = {
    onClick: (e: React.MouseEvent) => h.click(it.name, e),
    onDoubleClick: () => h.open(it),
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
        />
        <span className="lvli__name">{it.name}</span>
        {it.kind === 'broken' ? (
          <span className="lib__tag lvtag-broken" title={BROKEN_HINT}>
            missing chart
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
      <div className={`song lvcard lvcard--plain lvcard--broken ${cls}`} {...common} title={BROKEN_HINT}>
        {check}
        <div className="song__art lvart-icon lvart-broken">
          <Icon name="alert" size={26} />
        </div>
        <div className="song__main">
          <div className="song__title" title={it.name}>
            {it.name}
          </div>
          <div className="song__artist lvbroken-sub">Audio only, no chart file · Clone Hero won’t load it</div>
        </div>
        <div className="lvbroken-cell">
          <span className="lvbroken-badge">
            <Icon name="alert" size={13} /> Missing chart
          </span>
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
          <Icon name={it.kind === 'folder' ? 'folder' : 'file'} size={24} />
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
      <div className="song__art">
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
          {info?.artist ? <RichText text={info.artist} /> : <span className="lvdim">{it.name}</span>}
          {info?.album ? <span className="song__album"> · {stripTags(info.album)}</span> : null}
          {info?.year ? <span className="song__year"> · {info.year}</span> : null}
        </div>
        <div className="song__meta">
          {info?.lengthSeconds ? <span className="badge badge--len">{formatLength(info.lengthSeconds)}</span> : null}
          {it.isSng ? <span className="badge badge--native">.sng</span> : null}
          {info?.charter ? (
            <span className="song__charter">
              <Icon name="charter" size={12} /> <RichText text={info.charter} />
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
  detail,
  count,
  onOpen,
  onPlay,
  onMeta,
  onReveal,
  onDelete
}: {
  it: Item
  info: LibSongInfo | undefined
  detail: SongDetail | null
  count: number | undefined
  onOpen: () => void
  onPlay: () => void
  onMeta: () => void
  onReveal: () => void
  onDelete: () => void
}): JSX.Element {
  if (it.kind === 'broken') {
    return (
      <div className="lv__dsong">
        <div className="lv__dart lv__dart--none lvart-broken">
          <Icon name="alert" size={52} />
        </div>
        <div className="lv__dtitle">{it.name}</div>
        <div className="lvbroken-note">
          <strong>Missing chart file.</strong> This folder has the song’s audio but no{' '}
          <code>notes.mid</code> or <code>notes.chart</code>, so Clone Hero won’t load it. It’s
          usually an unfinished conversion. Download the chart again, or delete the folder.
        </div>
        <div className="lv__dactions">
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
        <div className="lv__dart lv__dart--none">
          <Icon name={it.kind === 'folder' ? 'folder' : 'file'} size={48} />
        </div>
        <div className="lv__dtitle">{it.name}</div>
        <div className="lv__dsub">
          {it.kind === 'folder' ? (count === undefined ? 'Folder' : `${count} ${count === 1 ? 'song' : 'songs'}`) : 'File'}
        </div>
        <div className="lv__dactions">
          {it.kind === 'folder' ? (
            <>
              <button className="btn-primary" onClick={onOpen}>Open folder</button>
              <button className="btn-secondary" onClick={onPlay}>
                <Icon name="play" size={13} /> Listen in music player
              </button>
            </>
          ) : null}
          <button className="btn-secondary" onClick={onReveal}>{IS_MAC ? 'Show in Finder' : 'Show in Explorer'}</button>
        </div>
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
      <div className="lv__dtitle">{d?.title ? <RichText text={d.title} /> : it.name}</div>
      {d?.artist ? (
        <div className="lv__dartist">
          <RichText text={d.artist} />
        </div>
      ) : null}
      <div className="lv__dsub">
        {[d?.album ? stripTags(d.album) : null, d?.year || null, d?.genre ? stripTags(d.genre) : null].filter(Boolean).join(' · ')}
      </div>
      <div className="lv__dactions">
        {!it.isSng ? (
          <>
            <button className="btn-primary" onClick={onPlay}>
              <Icon name="play" size={13} /> Play in music player
            </button>
            <button className="btn-secondary" onClick={onMeta}>Edit metadata</button>
          </>
        ) : null}
        <button className="btn-secondary" onClick={onReveal}>{IS_MAC ? 'Show in Finder' : 'Show in Explorer'}</button>
      </div>
      {d ? (
        <div className="lv__ddiffs">
          <InstrumentDifficulty difficulties={d.difficulties} />
        </div>
      ) : null}
      <dl className="lv__dkv">
        {d?.charter ? (
          <>
            <dt>Charter</dt>
            <dd>
              <RichText text={d.charter} />
            </dd>
          </>
        ) : null}
        {d?.lengthSeconds ? (
          <>
            <dt>Length</dt>
            <dd>{formatLength(d.lengthSeconds)}</dd>
          </>
        ) : null}
        <dt>Folder</dt>
        <dd className="lv__dpath">{it.rel}</dd>
      </dl>
    </div>
  )
}
