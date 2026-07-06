import { useEffect, useRef, useState } from 'react'
import type { LibEntry } from '../../../shared/types'
import { useStore } from '../store'
import { DuplicatesModal } from './DuplicatesModal'
import { Icon } from './Icon'
import { PlaylistDialog } from './PlaylistDialog'
import { SongMetaDialog } from './SongMetaDialog'

type Dialog =
  | { type: 'new' }
  | { type: 'rename'; name: string }
  | { type: 'delete'; names: string[] }
  | null
type Clip = { op: 'cut' | 'copy'; items: string[]; names: string[] } | null
type Ctx = { x: number; y: number } | null

export function LibraryManager(): JSX.Element | null {
  const show = useStore((s) => s.showLibrary)
  const close = useStore((s) => s.setShowLibrary)

  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<LibEntry[]>([])
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
  const dialogOpenRef = useRef(false)
  dialogOpenRef.current = dialog !== null

  const relOf = (name: string): string => (cwd ? `${cwd}/${name}` : name)
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  const selArr = (): string[] => entries.filter((e) => selected.has(e.name)).map((e) => e.name)

  const load = async (rel: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.libList(rel)
      setCwd(res.path)
      setEntries(res.entries)
      setSelected(new Set())
      setAnchor(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (show) void load('')
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
      const names = entries.map((x) => x.name)
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

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal modal--library" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Library manager</h2>
          <button className="modal__close" onClick={() => close(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="lib__toolbar">
          <button className="lib__btn" onClick={() => void load(segments.slice(0, -1).join('/'))} disabled={!cwd} title="Up">
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
          <div className="lib__spacer" />
          <button className="lib__btn" onClick={() => { setDialog({ type: 'new' }); setDialogValue('') }}>
            <Icon name="folderPlus" size={15} /> New folder
          </button>
          <button className="lib__btn" onClick={() => setDupOpen(true)} title="Find duplicate charts">
            <Icon name="copy" size={15} /> Duplicates
          </button>
          {clip ? (
            <button className="lib__btn lib__btn--accent" onClick={doPaste}>
              <Icon name="paste" size={15} /> Paste ({clip.items.length})
            </button>
          ) : null}
          <button className="lib__btn" onClick={() => window.api.libOpen(cwd)} title="Open in Explorer">
            <Icon name="external" size={15} />
          </button>
          <button className="lib__btn" onClick={() => void load(cwd)} title="Refresh">
            <Icon name="refresh" size={15} />
          </button>
        </div>

        {error ? <div className="lib__error">⚠ {error}</div> : null}

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
            entries.map((en) => (
              <div
                key={en.name}
                className={`lib__item ${selected.has(en.name) ? 'lib__item--sel' : ''} ${
                  clip && clip.op === 'cut' && clip.names.includes(en.name) ? 'lib__item--cut' : ''
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
                {en.type === 'dir' && !en.isSong ? <span className="lib__tag lib__tag--dir">folder</span> : null}
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
                      if (e.key === 'Enter') void confirmDialog()
                      if (e.key === 'Escape') setDialog(null)
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
      </div>
    </div>
  )
}
