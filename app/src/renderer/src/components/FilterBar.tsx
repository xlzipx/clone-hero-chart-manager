import { useState } from 'react'
import { useStore } from '../store'
import { INSTRUMENTS, MAX_DIFFICULTY } from '../utils'
import { DifficultyDots } from './DifficultyDots'
import { Dropdown } from './Dropdown'
import { Icon } from './Icon'

// Přípony, které pipeline umí zpracovat (archivy + .sng + Rock Band CON).
// Soubory BEZ přípony pouštíme dál a necháme backend rozhodnout podle magic
// bytů — některé hostingy stripují přípony (RB3 CON downloady z Mediafire
// často přijdou jen jako "ArtistTitle" bez .rb3con).
const ACCEPTED_EXT = /\.(zip|rar|7z|sng|rb3con|con)$/i

const LEVELS = Array.from({ length: MAX_DIFFICULTY + 1 }, (_, i) => i) // 0..6

export function FilterBar(): JSX.Element {
  const filters = useStore((s) => s.instrumentFilters)
  const toggle = useStore((s) => s.toggleInstrumentFilter)
  const diffMin = useStore((s) => s.diffMin)
  const diffMax = useStore((s) => s.diffMax)
  const setDiffRange = useStore((s) => s.setDiffRange)

  const diffActive = filters.length > 0
  const openLocalDrop = useStore((s) => s.openLocalDrop)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Kontrola jen pokud má přípona je SOUBOR vůbec MÁ a není v allowlistu.
    // Bez přípony pouštíme — backend si detekuje formát podle magic bytů.
    const hasExt = /\.[a-z0-9]{1,8}$/i.test(file.name)
    if (hasExt && !ACCEPTED_EXT.test(file.name)) {
      window.alert(
        `Unsupported file: "${file.name}". Drop a .zip / .rar / .7z / .sng / .rb3con / CON file (or a CON file without extension).`
      )
      return
    }
    const path = window.api.getDroppedFilePath(file)
    if (!path) {
      window.alert('Could not read the file path. Try again, or use the click-to-browse option.')
      return
    }
    void openLocalDrop(path, file.name)
  }

  return (
    <div className="filterbar">
      <span className="filterbar__label">Instruments:</span>
      <div className="instbtns">
        {INSTRUMENTS.map((inst) => {
          const active = filters.includes(inst.id)
          return (
            <button
              key={inst.id}
              className={`instbtn ${active ? 'instbtn--active' : ''}`}
              title={`Only songs with: ${inst.label}`}
              onClick={() => toggle(inst.id)}
              style={
                {
                  '--inst-color': inst.color
                } as React.CSSProperties
              }
            >
              <span className="instbtn__circle">
                <Icon name={inst.icon} size={28} color={inst.color} />
              </span>
              <span className="instbtn__label">{inst.label}</span>
            </button>
          )
        })}
      </div>

      <span className={`filterbar__diff ${diffActive ? '' : 'filterbar__diff--off'}`}>
        <span className="filterbar__label">Difficulty</span>
        <span
          className="info"
          title="Filters the selected instrument by its difficulty tier (0 = easiest, 6 = hardest). The first value is the MINIMUM, the second is the MAXIMUM — only songs whose selected instrument falls within this range are shown."
        >
          <Icon name="info" size={13} />
        </span>
        <span className="diffpick">
          <span className="diffpick__cap">min</span>
          <Dropdown
            value={diffMin}
            options={LEVELS}
            disabled={!diffActive}
            ariaLabel="Minimum difficulty"
            onChange={(v) => setDiffRange(v, diffMax)}
          />
        </span>
        <span className="filterbar__dash">–</span>
        <span className="diffpick">
          <span className="diffpick__cap">max</span>
          <Dropdown
            value={diffMax}
            options={LEVELS}
            disabled={!diffActive}
            ariaLabel="Maximum difficulty"
            onChange={(v) => setDiffRange(diffMin, v)}
          />
        </span>

        <span className="diffpick__cap diffpick__cap--or">exact</span>
        <DifficultyDots disabled={!diffActive} />
      </span>

      <button
        type="button"
        className={`dropzone ${dragOver ? 'dropzone--hover' : ''}`}
        title="Drop a chart file here, or click to browse (.zip / .rar / .7z / .sng / .rb3con). Rock Band CON and DTXMania songs (in an archive) are auto-converted."
        onClick={async () => {
          const picked = await window.api.chooseSongFile()
          if (picked) void openLocalDrop(picked.path, picked.name)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragOver(false)
        }}
        onDrop={handleDrop}
      >
        <Icon name="download" size={18} />
        <div className="dropzone__text">
          <strong>Drop a file or click to browse</strong>
          <span>.zip · .rar · .7z · .sng · .rb3con</span>
        </div>
      </button>
    </div>
  )
}
