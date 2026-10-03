import { useEffect, useMemo, useState } from 'react'
import type { LibEntry, LibSongInfo } from '../../../shared/types'
import { userMsg } from '../../../shared/errors'
import { cleanSegment, renderFolderTemplate } from '../../../shared/foldertemplate'
import { stripTags } from '../utils'
import { Icon } from './Icon'

/** Položka knihovny vybraná pro hromadnou akci. */
export interface BulkItem {
  name: string
  rel: string
  /** Složka písně nebo volné .sng. */
  isSong: boolean
  /** Volné .sng (soubor) — při přejmenování podle šablony zachová příponu. */
  isSng: boolean
  info?: LibSongInfo
}

type RowStatus = 'ok' | 'fix' | 'same' | 'skip'
interface PreviewRow {
  item: BulkItem
  next: string
  status: RowStatus
  note: string
}

const TEMPLATE_TAGS = ['{artist}', '{title}', '{album}', '{year}', '{charter}', '{genre}']

function splitExt(name: string): { stem: string; ext: string } {
  const m = /^(.*?)(\.[^.]+)?$/.exec(name)
  return { stem: m?.[1] ?? name, ext: m?.[2] ?? '' }
}

/** Náhled přejmenování: nový název, stav a důvod pro každou položku. */
function buildPreview(
  items: BulkItem[],
  siblings: string[],
  mode: 'tpl' | 'fr',
  template: string,
  find: string,
  replace: string
): PreviewRow[] {
  const selected = new Set(items.map((i) => i.name.toLowerCase()))
  // Obsazené názvy = sourozenci, kteří se nepřejmenovávají, + nově přidělené.
  const taken = new Set(siblings.filter((n) => !selected.has(n.toLowerCase())).map((n) => n.toLowerCase()))
  return items.map((item) => {
    let next = item.name
    let status: RowStatus = 'ok'
    let note = 'rename'
    if (mode === 'tpl') {
      if (!item.isSong) return { item, next: item.name, status: 'skip', note: 'not a song, skipped' }
      if (!item.info) return { item, next: item.name, status: 'skip', note: 'no song.ini, skipped' }
      const raw = item.info
      const fields = {
        artist: stripTags(raw.artist),
        title: stripTags(raw.title),
        album: stripTags(raw.album),
        genre: stripTags(raw.genre),
        year: raw.year,
        charter: stripTags(raw.charter)
      }
      const hadTags =
        fields.artist !== raw.artist.trim() || fields.title !== raw.title.trim() || fields.charter !== raw.charter.trim()
      next = renderFolderTemplate(fields, template).name + (item.isSng ? '.sng' : '')
      if (hadTags) {
        status = 'fix'
        note = 'color tags removed'
      }
    } else {
      if (!find) return { item, next: item.name, status: 'same', note: 'unchanged' }
      next = cleanSegment(item.name.split(find).join(replace))
      if (!next) return { item, next: item.name, status: 'skip', note: 'name would be empty, skipped' }
    }
    if (next === item.name) return { item, next, status: 'same', note: 'unchanged' }
    // Kolize → „ (2)" před příponu, jako to dělá kopírování v knihovně.
    const { stem, ext } = splitExt(next)
    let candidate = next
    let i = 2
    while (taken.has(candidate.toLowerCase())) candidate = `${stem} (${i++})${ext}`
    if (candidate !== next) {
      status = 'fix'
      note = `name taken, added (${i - 1})`
    }
    taken.add(candidate.toLowerCase())
    return { item, next: candidate, status, note }
  })
}

export function BulkRenameDialog({
  items,
  siblings,
  cwd,
  defaultTemplate,
  onClose,
  onDone
}: {
  items: BulkItem[]
  siblings: string[]
  cwd: string
  defaultTemplate: string
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const hasSongs = items.some((i) => i.isSong)
  const [mode, setMode] = useState<'tpl' | 'fr'>(hasSongs ? 'tpl' : 'fr')
  // Šablona ze Settings, ale jen poslední segment: přejmenovává se na místě.
  const [template, setTemplate] = useState(() => {
    const parts = defaultTemplate.split(/[\\/]/).filter((p) => p.trim())
    return parts[parts.length - 1] || '{artist} - {title}'
  })
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(
    () => buildPreview(items, siblings, mode, template, find, replace),
    [items, siblings, mode, template, find, replace]
  )
  const todo = rows.filter((r) => r.status === 'ok' || r.status === 'fix')
  const relOf = (name: string): string => (cwd ? `${cwd}/${name}` : name)

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const sources = new Set(todo.map((r) => r.item.name.toLowerCase()))
    // Cíl, který je zároveň zdrojem jiné (nebo té samé, jen jiná velikost písmen)
    // položky, se musí přejmenovat přes dočasný název, jinak by narazil na
    // „already exists".
    const viaTemp = todo.filter((r) => sources.has(r.next.toLowerCase()))
    const direct = todo.filter((r) => !sources.has(r.next.toLowerCase()))
    const failed: string[] = []
    let done = 0
    const temps = new Map<PreviewRow, string>()
    for (const [i, r] of viaTemp.entries()) {
      const tmp = `${r.item.name}.chm-rename-${Date.now()}-${i}`
      try {
        await window.api.libRename(relOf(r.item.name), tmp)
        temps.set(r, tmp)
      } catch (e) {
        failed.push(`${r.item.name}: ${userMsg(e)}`)
      }
    }
    for (const r of direct) {
      try {
        await window.api.libRename(relOf(r.item.name), r.next)
        done++
      } catch (e) {
        failed.push(`${r.item.name}: ${userMsg(e)}`)
      }
    }
    for (const [r, tmp] of temps) {
      try {
        await window.api.libRename(relOf(tmp), r.next)
        done++
      } catch (e) {
        failed.push(`${r.item.name}: ${userMsg(e)}`)
      }
    }
    setBusy(false)
    if (failed.length) {
      setError(`Renamed ${done}, ${failed.length} failed:\n${failed.slice(0, 5).join('\n')}`)
      onDone('')
      return
    }
    onDone(`Renamed ${done} item${done === 1 ? '' : 's'}`)
  }

  return (
    <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="lib__dialog lvdlg">
        <p className="metadlg__head">
          Rename <span className="metadlg__sub">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        </p>

        <div className="lvseg" role="group" aria-label="Rename mode">
          <button
            type="button"
            className={mode === 'tpl' ? 'on' : ''}
            disabled={!hasSongs}
            title={hasSongs ? undefined : 'Needs a song.ini, so it only works for songs'}
            onClick={() => setMode('tpl')}
          >
            From template
          </button>
          <button type="button" className={mode === 'fr' ? 'on' : ''} onClick={() => setMode('fr')}>
            Find &amp; replace
          </button>
        </div>

        {mode === 'tpl' ? (
          <>
            <label className="metadlg__field">
              <span>Template (from Settings, applied to the song folder name)</span>
              <input
                value={template}
                spellCheck={false}
                onChange={(e) => setTemplate(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
              />
            </label>
            <div className="lvtags">
              {TEMPLATE_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTemplate((v) => v + (v && !/\s$/.test(v) ? ' ' : '') + t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="field__hint">
              Songs are renamed in place and never moved to other folders. Values come from each
              song’s song.ini, with color tags removed.
            </p>
          </>
        ) : (
          <div className="lvtwo">
            <label className="metadlg__field">
              <span>Find</span>
              <input
                autoFocus
                value={find}
                spellCheck={false}
                placeholder="e.g. 02. "
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
              />
            </label>
            <label className="metadlg__field">
              <span>Replace with</span>
              <input
                value={replace}
                spellCheck={false}
                placeholder="leave empty to remove"
                onChange={(e) => setReplace(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
              />
            </label>
          </div>
        )}
        {mode === 'fr' && !hasSongs ? (
          <p className="field__hint">
            Folders are renamed with Find &amp; replace. From template needs a song.ini, so it only works for songs.
          </p>
        ) : null}

        <div className="lvpreview">
          <table>
            <thead>
              <tr>
                <th>Current name</th>
                <th aria-hidden="true" />
                <th>New name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item.name}>
                  <td className="lvpreview__old">{r.item.name}</td>
                  <td className="lvpreview__arr">→</td>
                  <td className="lvpreview__new">{r.next}</td>
                  <td>
                    <span className={`lvst lvst--${r.status}`}>{r.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error ? <p className="lib__error lvpre">⚠ {error}</p> : null}

        <div className="lib__dialog-foot">
          <span className="lvfoot-note">Nothing changes on disk until you confirm.</span>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            {error ? 'Close' : 'Cancel'}
          </button>
          <button className="btn-primary" disabled={busy || todo.length === 0} onClick={() => void apply()}>
            {busy
              ? 'Renaming…'
              : todo.length
                ? `Rename ${todo.length} item${todo.length === 1 ? '' : 's'}`
                : 'Nothing to rename'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Výběr cílové složky v knihovně pro hromadný přesun / kopii. */
export function FolderPickerDialog({
  items,
  mode,
  startAt,
  onClose,
  onDone
}: {
  items: BulkItem[]
  mode: 'move' | 'copy'
  startAt: string
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [at, setAt] = useState(startAt)
  const [dirs, setDirs] = useState<LibEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Nová složka přímo v dialogu: po vytvoření do ní rovnou vstoupíme.
  const [newName, setNewName] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const verb = mode === 'move' ? 'Move' : 'Copy'

  const createFolder = async (): Promise<void> => {
    const name = cleanSegment(newName ?? '')
    if (!name) return
    setError(null)
    try {
      await window.api.libCreateFolder(at, name)
      setNewName(null)
      setAt(at ? `${at}/${name}` : name)
      setReload((x) => x + 1)
    } catch (e) {
      setError(userMsg(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setDirs(null)
    void window.api
      .libList(at)
      .then((r) => !cancelled && setDirs(r.entries.filter((e) => e.type === 'dir' && !e.isSong)))
      .catch(() => !cancelled && setDirs([]))
    return () => {
      cancelled = true
    }
  }, [at, reload])

  const segs = at.split(/[\\/]/).filter(Boolean)
  const sourceParent = startAt
  // Do sebe sama ani do vlastní podsložky přesouvat nejde.
  const intoItself = items.some((i) => at === i.rel || at.startsWith(i.rel + '/'))
  const sameFolder = mode === 'move' && at === sourceParent

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const failed: string[] = []
    for (const it of items) {
      try {
        if (mode === 'move') await window.api.libMove(it.rel, at)
        else await window.api.libCopy(it.rel, at)
      } catch (e) {
        failed.push(`${it.name}: ${userMsg(e)}`)
      }
    }
    setBusy(false)
    const ok = items.length - failed.length
    if (failed.length) {
      setError(`${verb === 'Move' ? 'Moved' : 'Copied'} ${ok}, ${failed.length} failed:\n${failed.slice(0, 5).join('\n')}`)
      onDone('')
      return
    }
    onDone(`${verb === 'Move' ? 'Moved' : 'Copied'} ${ok} item${ok === 1 ? '' : 's'} to ${segs[segs.length - 1] || 'Songs'}`)
  }

  return (
    <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="lib__dialog lvdlg lvdlg--sm">
        <p className="metadlg__head">
          {verb} to… <span className="metadlg__sub">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        </p>
        <div className="lvpick__crumbs">
          <button type="button" onClick={() => setAt('')}>
            <Icon name="folder" size={13} /> Songs
          </button>
          {segs.map((s, i) => (
            <span key={i}>
              <span className="lvpick__sep">/</span>
              <button type="button" onClick={() => setAt(segs.slice(0, i + 1).join('/'))}>
                {s}
              </button>
            </span>
          ))}
          <span className="lib__spacer" />
          <button
            type="button"
            className="lvpick__new"
            disabled={busy || newName !== null}
            onClick={() => setNewName('')}
            title="Create a new folder here"
          >
            <Icon name="folderPlus" size={14} /> New folder
          </button>
        </div>
        <div className="lvpick">
          {newName !== null ? (
            <form
              className="lvpick__newrow"
              onSubmit={(e) => {
                e.preventDefault()
                void createFolder()
              }}
            >
              <Icon name="folderPlus" size={15} />
              <input
                autoFocus
                value={newName}
                spellCheck={false}
                placeholder="Folder name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewName(null)
                  }
                }}
              />
              <button type="submit" className="btn-primary" disabled={!cleanSegment(newName)}>
                Create
              </button>
              <button type="button" className="btn-secondary" onClick={() => setNewName(null)}>
                Cancel
              </button>
            </form>
          ) : null}
          {dirs === null ? (
            <p className="wn__muted">Loading…</p>
          ) : dirs.length === 0 ? (
            newName === null ? <p className="field__hint">No subfolders here.</p> : null
          ) : (
            dirs.map((d) => {
              const rel = at ? `${at}/${d.name}` : d.name
              const blocked = items.some((i) => i.rel === rel)
              return (
                <button key={d.name} type="button" disabled={blocked} onClick={() => setAt(rel)}>
                  <Icon name="folder" size={15} />
                  <span>{d.name}</span>
                  <Icon name="chevronRight" size={14} />
                </button>
              )
            })
          )}
        </div>
        {error ? <p className="lib__error lvpre">⚠ {error}</p> : null}
        <div className="lib__dialog-foot">
          <span className="lvfoot-note">
            {intoItself
              ? 'Can’t put a folder inside itself.'
              : sameFolder
                ? 'The items are already here.'
                : `${verb} into “${segs[segs.length - 1] || 'Songs'}”.`}
          </span>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            {error ? 'Close' : 'Cancel'}
          </button>
          <button className="btn-primary" disabled={busy || intoItself || sameFolder} onClick={() => void run()}>
            {busy ? `${verb === 'Move' ? 'Moving' : 'Copying'}…` : `${verb} here`}
          </button>
        </div>
      </div>
    </div>
  )
}
