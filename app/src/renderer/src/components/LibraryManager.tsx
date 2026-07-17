import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LibEntry, SongDetail } from '../../../shared/types'
import { useStore } from '../store'
import { formatLength, stripTags } from '../utils'
import { RichText } from './RichText'
import { DuplicatesModal } from './DuplicatesModal'
import { Icon } from './Icon'
import { InstrumentDifficulty } from './InstrumentDifficulty'
import { PlaylistDialog } from './PlaylistDialog'
import { PlaylistManagerModal } from './PlaylistManagerModal'
import { SongMetaDialog } from './SongMetaDialog'

type Dialog =
  | { type: 'new' }
  | { type: 'rename'; name: string }
  | { type: 'delete'; names: string[] }
  | null
type Clip = { op: 'cut' | 'copy'; items: string[]; names: string[] } | null
type Ctx = { x: number; y: number } | null

// „Size" záměrně NENÍ v nabídce: knihovna jsou hlavně složky a `statSync.size`
// u složky není velikost obsahu (~0). „Songs inside" je pro složky smysluplnější
// a levnější metrika velikosti; rekurzivní byte-velikost by byl další drahý sweep.
type LibSortKey = 'name' | 'songs' | 'modified' | 'created'
const LIB_SORTS: { id: LibSortKey; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'songs', label: 'Songs inside' },
  { id: 'modified', label: 'Date modified' },
  { id: 'created', label: 'Date added' }
]

export function LibraryManager(): JSX.Element | null {
  const show = useStore((s) => s.showLibrary)
  const close = useStore((s) => s.setShowLibrary)
  // Cíl z „In library" (kopie písně k odhalení). Víc = duplikáty → banner.
  const libraryReveal = useStore((s) => s.libraryReveal)
  const [revealActive, setRevealActive] = useState<string | null>(null)

  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<LibEntry[]>([])
  // Počty písní v PODsložkách (name → count), doplňují se asynchronně po výpisu.
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  // Řazení výpisu. Složky/soubory se drží pohromadě (dir-first), klíč řadí uvnitř.
  const [sortKey, setSortKey] = useState<LibSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Seřazený výpis pro RENDER i shift-výběr (rozsah musí sedět s viditelným
  // pořadím). Složky vždy nad soubory; sekundárně dle zvoleného klíče. `songs`
  // bere počty z `folderCounts` (async), takže se přeřadí, jakmile dorazí.
  const sortedEntries = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: LibEntry, b: LibEntry): number => {
      // Dir-first je pevné, nezávislé na směru — soubory nikdy nevytlačí složky.
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1
      let d = 0
      switch (sortKey) {
        case 'name':
          d = a.name.localeCompare(b.name, 'cs')
          break
        case 'songs':
          d = (folderCounts[a.name] ?? 0) - (folderCounts[b.name] ?? 0)
          break
        case 'modified':
          d = a.mtimeMs - b.mtimeMs
          break
        case 'created':
          d = a.birthtimeMs - b.birthtimeMs
          break
      }
      // Při shodě (stejný počet písní / datum) dorovnej jménem VZESTUPNĚ jako
      // stabilní tie-break — nezávisle na směru, ať pořadí neposkakuje.
      if (d === 0) return a.name.localeCompare(b.name, 'cs')
      return d * dir
    }
    return [...entries].sort(cmp)
  }, [entries, folderCounts, sortKey, sortDir])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [clip, setClip] = useState<Clip>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogValue, setDialogValue] = useState('')
  const [ctx, setCtx] = useState<Ctx>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Nové akce: editace metadat / přidání do playlistu / hledání duplicit.
  const [metaFor, setMetaFor] = useState<{ rel: string; title: string } | null>(null)
  const [playlistFor, setPlaylistFor] = useState<string[] | null>(null)
  const [dupOpen, setDupOpen] = useState(false)
  const [plmOpen, setPlmOpen] = useState(false)
  const dialogOpenRef = useRef(false)
  // Zkratky (Delete, Ctrl+V, Ctrl+A…) musí mlčet pod VŠEMI sub-modály — jinak
  // jde omylem smazat výběr schovaný pod otevřeným oknem Duplicates/Playlists.
  dialogOpenRef.current =
    dialog !== null || metaFor !== null || playlistFor !== null || dupOpen || plmOpen
  const ctxRef = useRef<HTMLDivElement>(null)
  // Detail otevřené písničky (když je aktuální složka píseň) — panel s obalem,
  // metadaty a obtížnostmi nad výpisem souborů.
  const [detail, setDetail] = useState<SongDetail | null>(null)

  // Kontextové menu je position:fixed na souřadnicích kliknutí — u položek dole
  // by přeteklo přes okraj obrazovky a useklo se. Po vykreslení ho změříme a
  // když nedosáhne, posuneme nahoru/doleva tak, aby se celé vešlo.
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

  const relOf = (name: string): string => (cwd ? `${cwd}/${name}` : name)
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  const selArr = (): string[] => entries.filter((e) => selected.has(e.name)).map((e) => e.name)

  // Token proti závodu: při rychlé navigaci vyhrává POSLEDNÍ vyžádaná složka,
  // ne ta, jejíž odpověď náhodou doběhne později. Stejný token kryje i detail
  // písně (pomalé čtení obalu nesmí zobrazit detail písně A nad složkou B).
  const loadSeq = useRef(0)

  const load = async (rel: string): Promise<void> => {
    const my = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.libList(rel)
      if (my !== loadSeq.current) return // mezitím proběhla novější navigace
      setCwd(res.path)
      setEntries(res.entries)
      setSelected(new Set())
      setAnchor(null)
      // Počty písní ve složkách dotáhni na pozadí (rekurzivní čtení disku) — výpis
      // se ukáže hned a odznaky „N songs" naskočí, jakmile dorazí.
      setFolderCounts({})
      void window.api.libFolderCounts(res.path).then((c) => {
        if (my === loadSeq.current) setFolderCounts(c)
      })
      // Je aktuální složka píseň? (obsahuje song.ini / notes.chart / notes.mid) →
      // dotáhni detail (metadata + obal) pro panel nad výpisem souborů.
      const markers = ['song.ini', 'notes.chart', 'notes.mid']
      const isSong = res.entries.some(
        (e) => e.type === 'file' && markers.includes(e.name.toLowerCase())
      )
      if (isSong) {
        setDetail(null)
        void window.api
          .libSongDetail(res.path)
          .then((d) => {
            if (my === loadSeq.current) setDetail(d)
          })
          .catch(() => {
            /* panel prostě nebude */
          })
      } else {
        setDetail(null)
      }
    } catch (e) {
      if (my !== loadSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (my === loadSeq.current) setLoading(false)
    }
  }

  // Naviguje do složky s danou kopií písně (rel k Songs) a vybere ji.
  const revealTarget = async (rel: string): Promise<void> => {
    const parts = rel.split(/[\\/]/).filter(Boolean)
    const name = parts.pop() ?? ''
    const parent = parts.join('/')
    // load() bumpne loadSeq synchronně; zapamatujeme si token a po awaitu
    // ověříme, že nás nepředběhla novější navigace (rychlé klikání na kopie).
    const p = load(parent)
    const mySeq = loadSeq.current
    await p
    if (mySeq !== loadSeq.current) return
    setRevealActive(rel)
    if (name) {
      setSelected(new Set([name]))
      setAnchor(name)
      // Doscrolluj na vybranou položku (po překreslení).
      setTimeout(() => {
        document
          .querySelector('.lib__list .lib__item--sel')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 60)
    }
  }

  // Otevření: buď rovnou na cíli z „In library" (první kopie), nebo na kořeni.
  useEffect(() => {
    if (!show) return
    const targets = useStore.getState().libraryReveal
    if (targets && targets.length) {
      void revealTarget(targets[0])
    } else {
      setRevealActive(null)
      void load('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      setError(null)
      await fn()
      await load(cwd)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Klávesové zkratky (Delete, Ctrl+C/X/V/A, F2)
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || dialogOpenRef.current) return
      const names = entries.filter((x) => selected.has(x.name)).map((x) => x.name)
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Delete' && names.length) {
        e.preventDefault()
        setDialog({ type: 'delete', names })
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(entries.map((x) => x.name)))
      } else if (ctrl && e.key.toLowerCase() === 'c' && names.length) {
        setClip({ op: 'copy', items: names.map(relOf), names })
      } else if (ctrl && e.key.toLowerCase() === 'x' && names.length) {
        setClip({ op: 'cut', items: names.map(relOf), names })
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        doPaste()
      } else if (e.key === 'F2' && names.length === 1) {
        setDialog({ type: 'rename', name: names[0] })
        setDialogValue(names[0])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, entries, selected, cwd, clip])

  if (!show) return null

  const onItemClick = (name: string, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      next.has(name) ? next.delete(name) : next.add(name)
      setSelected(next)
      setAnchor(name)
    } else if (e.shiftKey && anchor) {
      const names = sortedEntries.map((x) => x.name)
      const a = names.indexOf(anchor)
      const b = names.indexOf(name)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelected(new Set(names.slice(lo, hi + 1)))
      }
    } else {
      setSelected(new Set([name]))
      setAnchor(name)
    }
  }

  const openCtx = (e: React.MouseEvent, name: string | null): void => {
    e.preventDefault()
    e.stopPropagation()
    if (name && !selected.has(name)) {
      setSelected(new Set([name]))
      setAnchor(name)
    } else if (!name) {
      setSelected(new Set())
    }
    setCtx({ x: e.clientX, y: e.clientY })
  }

  const doCut = (): void => {
    const names = selArr()
    if (names.length) setClip({ op: 'cut', items: names.map(relOf), names })
  }
  const doCopy = (): void => {
    const names = selArr()
    if (names.length) setClip({ op: 'copy', items: names.map(relOf), names })
  }
  const doPaste = (): void => {
    if (!clip) return
    void run(async () => {
      for (const item of clip.items) {
        if (clip.op === 'cut') await window.api.libMove(item, cwd)
        else await window.api.libCopy(item, cwd)
      }
      if (clip.op === 'cut') setClip(null)
    })
  }

  const confirmDialog = async (): Promise<void> => {
    const d = dialog
    if (!d) return
    if (d.type === 'new') {
      await run(() => window.api.libCreateFolder(cwd, dialogValue.trim()))
    } else if (d.type === 'rename') {
      await run(() => window.api.libRename(relOf(d.name), dialogValue.trim()))
    } else if (d.type === 'delete') {
      await run(async () => {
        for (const n of d.names) await window.api.libTrash(relOf(n))
      })
    }
    setDialog(null)
  }

  const selCount = selected.size
  const single = selCount === 1
  const singleName = single ? selArr()[0] : null
  const singleEntry = single ? entries.find((e) => e.name === singleName) : undefined
  const singleIsDir = singleEntry?.type === 'dir'
  const singleIsSong = !!singleEntry?.isSong
  // Vybrané složky písní (pro playlist / metadata).
  const selSongRels = (): string[] =>
    entries.filter((e) => selected.has(e.name) && e.isSong).map((e) => relOf(e.name))
  const selSongCount = entries.filter((e) => selected.has(e.name) && e.isSong).length

  // Plnohodnotný pod-modal (metadata / playlist / duplicates) → schovej Library
  // manager pod ním, ať se nestohují modaly a nezdvojuje ztmavení pozadí.
  const subModalOpen = metaFor !== null || playlistFor !== null || dupOpen || plmOpen

  return (
    <div
      className={`modal-overlay ${subModalOpen ? 'modal-overlay--has-sub' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div className="modal modal--library" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Library manager</h2>
          <button className="modal__close" onClick={() => close(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Řádek 1: cesta (breadcrumbs) — vlastní řádek, ať dlouhá cesta nikdy
            netlačí do nástrojů a layout nepřeskakuje. Přeteče → vodorovný scroll. */}
        <div className="lib__crumbsrow">
          <button className="lib__btn lib__btn--icon" onClick={() => void load(segments.slice(0, -1).join('/'))} disabled={!cwd} title="Up one folder">
            <Icon name="chevronLeft" size={15} />
          </button>
          <div className="lib__crumbs">
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
        </div>

        {/* Řádek 2: nástroje — akce vlevo, řazení + Explorer/Refresh vpravo. */}
        <div className="lib__toolbar">
          <button className="lib__btn" onClick={() => { setDialog({ type: 'new' }); setDialogValue('') }}>
            <Icon name="folderPlus" size={15} /> New folder
          </button>
          <button className="lib__btn" onClick={() => setPlmOpen(true)} title="Manage Clone Hero playlists">
            <Icon name="note" size={15} /> Playlists
          </button>
          <button className="lib__btn" onClick={() => setDupOpen(true)} title="Find duplicate charts">
            <Icon name="copy" size={15} /> Duplicates
          </button>
          {clip ? (
            <button className="lib__btn lib__btn--accent" onClick={doPaste}>
              <Icon name="paste" size={15} /> Paste ({clip.items.length})
            </button>
          ) : null}
          <div className="lib__spacer" />
          <div className="lib__sort" title="Sort this folder">
            <select
              className="lib__sortsel"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as LibSortKey)}
            >
              {LIB_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              className="lib__sortdir"
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              <Icon name="caret" size={12} style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none' }} />
            </button>
          </div>
          <button className="lib__btn lib__btn--icon" onClick={() => window.api.libOpen(cwd)} title="Open in Explorer">
            <Icon name="external" size={15} />
          </button>
          <button className="lib__btn lib__btn--icon" onClick={() => void load(cwd)} title="Refresh">
            <Icon name="refresh" size={15} />
          </button>
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

        {detail?.info ? (
          <div className="songdetail">
            {detail.albumArt ? (
              <img className="songdetail__art" src={detail.albumArt} alt="" />
            ) : (
              <div className="songdetail__art songdetail__art--none">
                <Icon name="note" size={26} />
              </div>
            )}
            <div className="songdetail__meta">
              <div className="songdetail__title">
                {detail.info.title ? (
                  <RichText text={detail.info.title} />
                ) : (
                  segments[segments.length - 1]
                )}
              </div>
              {detail.info.artist ? (
                <div className="songdetail__artist">
                  <RichText text={detail.info.artist} />
                </div>
              ) : null}
              <div className="songdetail__sub">
                {[stripTags(detail.info.album), detail.info.year || null, stripTags(detail.info.genre)]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div className="songdetail__sub">
                {detail.info.charter ? (
                  <>
                    by <RichText text={detail.info.charter} />
                  </>
                ) : null}
                {detail.info.charter && detail.info.lengthSeconds ? ' · ' : null}
                {detail.info.lengthSeconds ? formatLength(detail.info.lengthSeconds) : null}
              </div>
              <div className="songdetail__diffs">
                <InstrumentDifficulty difficulties={detail.info.difficulties} />
              </div>
            </div>
            <button
              className="btn-secondary songdetail__edit"
              onClick={() =>
                setMetaFor({ rel: cwd, title: segments[segments.length - 1] || 'song' })
              }
            >
              Edit metadata
            </button>
          </div>
        ) : null}

        <div
          className="lib__list"
          onContextMenu={(e) => e.target === e.currentTarget && openCtx(e, null)}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !e.ctrlKey && !e.shiftKey) setSelected(new Set())
          }}
        >
          {loading ? (
            <div className="lib__empty">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="lib__empty">This folder is empty. Right-click for New folder / Paste.</div>
          ) : (
            sortedEntries.map((en) => (
              <div
                key={en.name}
                className={`lib__item ${selected.has(en.name) ? 'lib__item--sel' : ''} ${
                  clip && clip.op === 'cut' && clip.items.includes(relOf(en.name))
                    ? 'lib__item--cut'
                    : ''
                }`}
                onClick={(e) => onItemClick(en.name, e)}
                onDoubleClick={() => en.type === 'dir' && void load(relOf(en.name))}
                onContextMenu={(e) => openCtx(e, en.name)}
              >
                <Icon
                  name={en.type === 'dir' ? 'folder' : en.name.toLowerCase().endsWith('.sng') ? 'note' : 'file'}
                  size={17}
                  color={en.isSong ? 'var(--accent)' : undefined}
                />
                <span className="lib__name">{en.name}</span>
                {en.isSong ? <span className="lib__tag">song</span> : null}
                {en.type === 'dir' && !en.isSong ? (
                  folderCounts[en.name] > 0 ? (
                    <span className="lib__tag lib__tag--count">
                      {folderCounts[en.name]} {folderCounts[en.name] === 1 ? 'song' : 'songs'}
                    </span>
                  ) : (
                    <span className="lib__tag lib__tag--dir">folder</span>
                  )
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="lib__actions">
          <span className="lib__selinfo">
            {selCount ? `${selCount} selected` : `${entries.length} items`}
            {clip ? ` · ${clip.items.length} on clipboard (${clip.op})` : ''}
          </span>
          <div className="lib__spacer" />
          <span className="lib__hint">Right-click for actions · Ctrl+C/X/V · Del · F2</span>
        </div>

        {/* Context menu */}
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
            <div
              ref={ctxRef}
              className="ctxmenu"
              style={{ left: ctx.x, top: ctx.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
            {singleIsDir ? (
              <button className="ctxmenu__item" onClick={() => { void load(relOf(singleName!)); setCtx(null) }}>
                <Icon name="folder" size={14} /> Open
              </button>
            ) : null}
            {single ? (
              <button
                className="ctxmenu__item"
                onClick={() => { setDialog({ type: 'rename', name: singleName! }); setDialogValue(singleName!); setCtx(null) }}
              >
                <Icon name="charter" size={14} /> Rename
              </button>
            ) : null}
            {single && singleIsSong ? (
              <button
                className="ctxmenu__item"
                onClick={() => { setMetaFor({ rel: relOf(singleName!), title: singleName! }); setCtx(null) }}
              >
                <Icon name="file" size={14} /> Edit metadata
              </button>
            ) : null}
            {selSongCount > 0 ? (
              <button
                className="ctxmenu__item"
                onClick={() => { setPlaylistFor(selSongRels()); setCtx(null) }}
              >
                <Icon name="note" size={14} /> Add to playlist ({selSongCount})
              </button>
            ) : null}
            {selCount ? (
              <>
                <div className="ctxmenu__sep" />
                <button className="ctxmenu__item" onClick={() => { doCopy(); setCtx(null) }}>
                  <Icon name="copy" size={14} /> Copy
                </button>
                <button className="ctxmenu__item" onClick={() => { doCut(); setCtx(null) }}>
                  <Icon name="scissors" size={14} /> Cut
                </button>
                <button className="ctxmenu__item ctxmenu__item--danger" onClick={() => { setDialog({ type: 'delete', names: selArr() }); setCtx(null) }}>
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

        {/* Dialog */}
        {dialog ? (
          <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
            <div className="lib__dialog">
              {dialog.type === 'delete' ? (
                <>
                  <p>
                    Move {dialog.names.length === 1 ? <strong>{dialog.names[0]}</strong> : `${dialog.names.length} items`} to the Recycle Bin?
                  </p>
                  <div className="lib__dialog-foot">
                    <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => void confirmDialog()}>Delete</button>
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
                        void confirmDialog()
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation() // jinak window handler zavře celý Library manager
                        setDialog(null)
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

      </div>

      {/* Pod-modaly jsou uvnitř Library overlay (sourozenci boxu), ale se svým
          PRŮHLEDNÝM overlayem — ztmavení pozadí drží pořád Library overlay, takže
          při přepínání nic neprobliká. Box Library se skryje přes --has-sub. */}
      {metaFor ? (
        <SongMetaDialog
          rel={metaFor.rel}
          title={metaFor.title}
          onClose={() => setMetaFor(null)}
          onSaved={() => void load(cwd)}
        />
      ) : null}
      {playlistFor ? (
        <PlaylistDialog rels={playlistFor} onClose={() => setPlaylistFor(null)} />
      ) : null}
      {dupOpen ? (
        <DuplicatesModal onClose={() => setDupOpen(false)} onChanged={() => void load(cwd)} />
      ) : null}
      {plmOpen ? <PlaylistManagerModal onClose={() => setPlmOpen(false)} /> : null}
    </div>
  )
}
