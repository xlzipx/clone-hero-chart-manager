import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Volby stahování (jako „Download format" na webu Chorus Encore): formát
 * chartů z Encore a videa na pozadí. Ukládají se do nastavení a platí pro
 * všechna další stažení. Sdílí je ⋮ menu řádku i hromadné stahování.
 *
 * `encore`: 'choice' = ukázat volbu formátu, 'note' = jen poznámka (řádek
 * z RhythmVerse, kde se soubory vždy rozbalují).
 * `rb`: ukázat volbu pro Rock Band charty (převést na Clone Hero / originál).
 */
export function DownloadOptions({ encore, rb = false }: { encore: 'choice' | 'note'; rb?: boolean }): JSX.Element {
  const encoreFormat = useStore((s) => s.config?.encoreFormat ?? 'folder')
  const rbFormat = useStore((s) => s.config?.rbFormat ?? 'convert')
  const downloadVideos = useStore((s) => s.config?.downloadVideos ?? true)
  const saveConfig = useStore((s) => s.saveConfig)

  return (
    <>
      <div className="rowmenu__label">Download format</div>
      {encore === 'choice' ? (
        <>
          <button
            className={`rowmenu__item rowmenu__opt ${encoreFormat === 'folder' ? 'on' : ''}`}
            role="menuitemradio"
            aria-checked={encoreFormat === 'folder'}
            title="Unpacked into a normal song folder, the same as the .zip option on Chorus Encore"
            onClick={() => void saveConfig({ encoreFormat: 'folder' })}
          >
            <span className="rowmenu__radio" /> Song folder (.zip)
            <span className="rowmenu__rec">recommended</span>
          </button>
          <button
            className={`rowmenu__item rowmenu__opt ${encoreFormat === 'sng' ? 'on' : ''}`}
            role="menuitemradio"
            aria-checked={encoreFormat === 'sng'}
            title="Kept as one .sng file. Clone Hero v1 and newer and YARG read it directly."
            onClick={() => void saveConfig({ encoreFormat: 'sng' })}
          >
            <span className="rowmenu__radio" /> Single .sng file
          </button>
        </>
      ) : rb ? null : (
        <div className="rowmenu__note">Song folder (RhythmVerse files are always unpacked)</div>
      )}
      {rb ? (
        <>
          {encore === 'choice' ? <div className="rowmenu__label">Rock Band charts</div> : null}
          <button
            className={`rowmenu__item rowmenu__opt ${rbFormat === 'convert' ? 'on' : ''}`}
            role="menuitemradio"
            aria-checked={rbFormat === 'convert'}
            title="Converted into a Clone Hero song folder while it downloads, playable in Clone Hero and YARG"
            onClick={() => void saveConfig({ rbFormat: 'convert' })}
          >
            <span className="rowmenu__radio" /> Convert to Clone Hero
          </button>
          <button
            className={`rowmenu__item rowmenu__opt ${rbFormat === 'original' ? 'on' : ''}`}
            role="menuitemradio"
            aria-checked={rbFormat === 'original'}
            title="Saved exactly as it is on the database, for example an RB3CON for Rock Band 3 on Xbox 360. Not playable in Clone Hero."
            onClick={() => void saveConfig({ rbFormat: 'original' })}
          >
            <span className="rowmenu__radio" /> Original file (no conversion)
          </button>
        </>
      ) : null}
      <button
        className={`rowmenu__item rowmenu__opt ${downloadVideos ? 'on' : ''}`}
        role="menuitemcheckbox"
        aria-checked={downloadVideos}
        title={
          encoreFormat === 'sng'
            ? 'Video backgrounds can be large. Turn off to skip them in song folders (a .sng file keeps its video).'
            : 'Video backgrounds can be large. Turn off to skip them.'
        }
        onClick={() => void saveConfig({ downloadVideos: !downloadVideos })}
      >
        <span className="rowmenu__checkbox">
          <Icon name="check" size={11} />
        </span>{' '}
        Download background videos
      </button>
    </>
  )
}

/**
 * Tlačítko se šipkou vedle „Download selected": otevře stejné volby stahování
 * pro hromadné stažení (Chorus formát platí pro Chorus položky ve výběru).
 */
export function BatchDownloadOptions(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const WIDTH = 270

  useLayoutEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.right - WIDTH) })
    const close = (): void => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [open])

  // Klik ani dvojklik v menu nesmí propadnout do řádků / lišty pod ním.
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`batchbar__opts ${open ? 'on' : ''}`}
        title="Download format"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onDoubleClick={stop}
      >
        <Icon name="caret" size={12} />
      </button>
      {open && pos
        ? createPortal(
            <>
              <div className="rowmenu__backdrop" onMouseDown={() => setOpen(false)} />
              <div
                className="rowmenu__menu rowmenu__menu--portal"
                style={{ top: pos.top, left: pos.left, width: WIDTH }}
                role="menu"
                onMouseDown={stop}
                onClick={stop}
                onDoubleClick={stop}
              >
                <DownloadOptions encore="choice" rb />
                <div className="rowmenu__note">Each format applies to the matching charts in your selection.</div>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
