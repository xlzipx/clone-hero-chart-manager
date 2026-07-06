import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

export function LocalDropModal(): JSX.Element | null {
  const pending = useStore((s) => s.pendingLocal)
  const folders = useStore((s) => s.folders)
  const foldersLoading = useStore((s) => s.foldersLoading)
  const lastSubfolder = useStore((s) => s.lastSubfolder)
  const confirm = useStore((s) => s.confirmLocalDrop)
  const cancel = useStore((s) => s.cancelLocalDrop)

  const [artist, setArtist] = useState('')
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<string>(lastSubfolder)
  const [newFolder, setNewFolder] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (pending) {
      setArtist(pending.suggestedArtist)
      setTitle(pending.suggestedTitle)
      setSelected(lastSubfolder)
      setNewFolder('')
      setFilter('')
    }
  }, [pending, lastSubfolder])

  const filtered = useMemo(
    () => folders.filter((f) => f.toLowerCase().includes(filter.toLowerCase())),
    [folders, filter]
  )

  if (!pending) return null

  const target = newFolder.trim() || selected
  const submit = (): void => {
    void confirm(artist, title, target)
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div
        className="modal modal--folder"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') {
            e.preventDefault()
            e.stopPropagation() // nesmí propadnout na window handler
            if (!e.repeat) submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation() // jinak window handler schová celé okno aplikace
            cancel()
          }
        }}
      >
        <div className="modal__head">
          <h2>Add dropped file</h2>
          <button className="modal__close" onClick={cancel}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <div className="folder-song">
            <Icon name="file" size={14} /> {pending.fileName}
          </div>

          <div className="drop-fields">
            <label className="field">
              <span>Artist</span>
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist (e.g. Linkin Park)"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Song title"
              />
            </label>
          </div>

          <input
            className="folder-filter"
            placeholder="Filter folders…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <div className="folder-list">
            <button
              className={`folder-item ${selected === '' && !newFolder ? 'folder-item--sel' : ''}`}
              onClick={() => {
                setSelected('')
                setNewFolder('')
              }}
            >
              <Icon name="folder" size={15} /> <em>(Songs root)</em>
            </button>
            {foldersLoading ? (
              <div className="folder-empty">Loading folders…</div>
            ) : filtered.length === 0 ? (
              <div className="folder-empty">No subfolders.</div>
            ) : (
              filtered.map((f) => (
                <button
                  key={f}
                  className={`folder-item ${selected === f && !newFolder ? 'folder-item--sel' : ''}`}
                  onClick={() => {
                    setSelected(f)
                    setNewFolder('')
                  }}
                  onDoubleClick={() => {
                    setSelected(f)
                    setNewFolder('')
                    void confirm(artist, title, f)
                  }}
                >
                  <Icon name="folder" size={15} /> {f}
                </button>
              ))
            )}
          </div>

          <label className="field">
            <span>…or create a new folder</span>
            <input
              placeholder="New folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
          </label>
        </div>

        <div className="modal__foot">
          <button className="btn-secondary" onClick={cancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            {newFolder.trim()
              ? `Create & install → ${newFolder.trim()}`
              : target
                ? `Install → ${target}`
                : 'Install to root'}
          </button>
        </div>
      </div>
    </div>
  )
}
