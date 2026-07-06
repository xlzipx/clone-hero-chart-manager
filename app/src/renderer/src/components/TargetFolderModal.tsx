import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

export function TargetFolderModal(): JSX.Element | null {
  const pendingSong = useStore((s) => s.pendingSong)
  const pendingBatch = useStore((s) => s.pendingBatch)
  const pendingLocalBatch = useStore((s) => s.pendingLocalBatch)
  const folders = useStore((s) => s.folders)
  const foldersLoading = useStore((s) => s.foldersLoading)
  const lastSubfolder = useStore((s) => s.lastSubfolder)
  const confirmDownload = useStore((s) => s.confirmDownload)
  const cancelDownload = useStore((s) => s.cancelDownload)
  const confirmBatchDownload = useStore((s) => s.confirmBatchDownload)
  const cancelBatchDownload = useStore((s) => s.cancelBatchDownload)
  const confirmLocalBatch = useStore((s) => s.confirmLocalBatch)
  const cancelLocalBatch = useStore((s) => s.cancelLocalBatch)

  const isLocalBatch = pendingLocalBatch !== null
  const isBatch = pendingBatch !== null || isLocalBatch
  const batchCount = pendingBatch?.length ?? pendingLocalBatch?.length ?? 0

  const [selected, setSelected] = useState<string>(lastSubfolder)
  const [newFolder, setNewFolder] = useState('')
  const [filter, setFilter] = useState('')
  const newInputRef = useRef<HTMLInputElement>(null)

  // Reset při otevření (pro píseň i pro dávku).
  useEffect(() => {
    if (pendingSong || pendingBatch || pendingLocalBatch) {
      setSelected(lastSubfolder)
      setNewFolder('')
      setFilter('')
    }
  }, [pendingSong, pendingBatch, pendingLocalBatch, lastSubfolder])

  const filtered = useMemo(
    () => folders.filter((f) => f.toLowerCase().includes(filter.toLowerCase())),
    [folders, filter]
  )

  if (!pendingSong && !pendingBatch && !pendingLocalBatch) return null

  // Cíl: nová složka má přednost, jinak vybraná (prázdné = kořen Songs).
  const target = newFolder.trim() || selected

  const cancel = (): void => {
    if (isLocalBatch) cancelLocalBatch()
    else if (pendingBatch) cancelBatchDownload()
    else cancelDownload()
  }
  const confirm = (): void => {
    if (isLocalBatch) void confirmLocalBatch(target)
    else if (pendingBatch) void confirmBatchDownload(target)
    else void confirmDownload(target)
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
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation() // nesmí propadnout na window handler (stáhl by vybraný řádek)
            if (!e.repeat) confirm() // držení Enteru nesmí potvrdit vícekrát
          } else if (e.key === 'Escape') {
            e.stopPropagation() // jinak window handler schová celé okno aplikace
            cancel()
          }
        }}
      >
        <div className="modal__head">
          <h2>Where to save?</h2>
          <button className="modal__close" onClick={cancel}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <div className="folder-song">
            {isLocalBatch ? (
              <strong>
                {batchCount} {batchCount === 1 ? 'item' : 'items'} dropped
              </strong>
            ) : isBatch ? (
              <strong>
                {batchCount} {batchCount === 1 ? 'song' : 'songs'} selected
              </strong>
            ) : (
              <>
                {pendingSong?.artist} – <strong>{pendingSong?.title}</strong>
              </>
            )}
          </div>

          <input
            className="folder-filter"
            placeholder="Filter folders…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
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
                    if (isLocalBatch) void confirmLocalBatch(f)
                    else if (pendingBatch) void confirmBatchDownload(f)
                    else void confirmDownload(f)
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
              ref={newInputRef}
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
          <button className="btn-primary" onClick={confirm}>
            {isBatch
              ? `Download ${batchCount} → ${target || 'root'}`
              : newFolder.trim()
                ? `Create & download → ${newFolder.trim()}`
                : target
                  ? `Download → ${target}`
                  : 'Download to root'}
          </button>
        </div>
      </div>
    </div>
  )
}
