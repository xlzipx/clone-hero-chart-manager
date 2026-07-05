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

  // Difficulty je použitelná vždy: s vybranými nástroji filtruje je, bez výběru
  // platí „jakýkoli nástroj v rozsahu".
  const anyInstrument = filters.length === 0
  const openLocalDrop = useStore((s) => s.openLocalDrop)
  const openLocalBatch = useStore((s) => s.openLocalBatch)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length === 0) return
    const paths = files
      .map((f) => window.api.getDroppedFilePath(f))
      .filter((p): p is string => !!p)
    if (paths.length === 0) {
      window.alert('Could not read the file paths. Try again, or use the click-to-browse option.')
      return
    }

    // Jediný soubor s příponou → modal s potvrzením metadat (nejlepší UX).
    // Víc položek nebo složka → hromadná dávka (metadata z názvů, jeden výběr cíle).
    const single = files[0]
    const singleHasExt = /\.[a-z0-9]{1,8}$/i.test(single.name)
    if (paths.length === 1 && singleHasExt) {
      if (!ACCEPTED_EXT.test(single.name)) {
        window.alert(
          `Unsupported file: "${single.name}". Drop a .zip / .rar / .7z / .sng / .rb3con / CON file, multiple files, or a folder.`
        )
        return
      }
      void openLocalDrop(paths[0], single.name)
      return
    }
    void openLocalBatch(paths)
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

      <span className="filterbar__diff">
        <span className="filterbar__label">Difficulty</span>
        <span
          className="info"
          title={
            anyInstrument
              ? 'Difficulty tier 0 (easiest) to 6 (hardest). With no instrument selected, shows songs where ANY instrument falls within this range. Select instruments above to target them specifically.'
              : 'Filters the selected instruments by their difficulty tier (0 = easiest, 6 = hardest). Only songs whose selected instruments fall within this MIN–MAX range are shown.'
          }
        >
          <Icon name="info" size={13} />
        </span>
        <span className="diffpick">
          <span className="diffpick__cap">min</span>
          <Dropdown
            value={diffMin}
            options={LEVELS}
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
            ariaLabel="Maximum difficulty"
            onChange={(v) => setDiffRange(diffMin, v)}
          />
        </span>

        <span className="diffpick__cap diffpick__cap--or">exact</span>
        <DifficultyDots disabled={false} />
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
          <strong>Drop files or a folder, or click to browse</strong>
          <span>.zip · .rar · .7z · .sng · .rb3con · CON · DTX</span>
        </div>
      </button>
    </div>
  )
}
