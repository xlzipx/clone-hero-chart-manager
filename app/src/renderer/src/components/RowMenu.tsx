import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SongResult } from '../../../shared/types'
import { useStore } from '../store'
import { DownloadOptions } from './DownloadOptions'
import { Icon } from './Icon'

const MENU_WIDTH = 264
const MENU_GAP = 6

/** Kontextové ⋮ menu u řádku skladby.
 *
 *  Renderuje se přes React portal do document.body, takže:
 *   - nezávisí na overflow/clipping rodičů (řádek, .results scroller, …),
 *   - nemá stacking context konflikty s tlačítky sousedních řádků,
 *   - drží se vždy nad vším ostatním.
 */
export function RowMenu({ song }: { song: SongResult }): JSX.Element {
  const openKey = useStore((s) => s.openRowMenu)
  const setOpenKey = useStore((s) => s.setOpenRowMenu)
  const isEncore = song.key.startsWith('enchor:')
  const open = openKey === song.key

  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Spočítá pozici menu z bounding rectu ⋮ tlačítka. Když uživatel scrolluje,
  // zavřeme menu úplně (jednodušší než resync pozice).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = (): void => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const top = Math.min(window.innerHeight - (isEncore ? 380 : 290), r.bottom + MENU_GAP)
      const left = Math.max(8, r.right - MENU_WIDTH)
      setPos({ top, left })
    }
    update()
    const close = (): void => setOpenKey(null)
    window.addEventListener('resize', close)
    // Scroll v .results vyvolá native scroll na něm. Posloucháme capture, aby
    // zachytil i vnořené scrollery (.queue__list apod.).
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, setOpenKey, isEncore])

  const pageUrl = song.downloadPageUrl || song.downloadUrl
  const link = song.downloadUrl || song.downloadPageUrl

  // Menu je v portálu, ale React mu události pořád probublává do řádku:
  // dvojklik na volbu by jinak spustil stažení (onDoubleClick řádku).
  const stop = (e: React.MouseEvent): void => {
    e.stopPropagation()
  }

  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setOpenKey(open ? null : song.key)
  }

  const close = (): void => setOpenKey(null)

  const menu =
    open && pos
      ? createPortal(
          <>
            <div
              className="rowmenu__backdrop"
              onMouseDown={(e) => {
                e.stopPropagation()
                close()
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
            <div
              className="rowmenu__menu rowmenu__menu--portal"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              role="menu"
              onMouseDown={stop}
              onClick={stop}
              onDoubleClick={stop}
            >
              <DownloadOptions encore={isEncore ? 'choice' : 'note'} rb={song.needsConversion} />
              <div className="rowmenu__sep" />
              {pageUrl ? (
                <button
                  className="rowmenu__item"
                  role="menuitem"
                  onClick={() => {
                    window.api.openExternal(pageUrl)
                    close()
                  }}
                >
                  <Icon name="globe" size={15} /> Open page in browser
                </button>
              ) : null}
              {song.driveFolderUrl ? (
                <button
                  className="rowmenu__item"
                  role="menuitem"
                  title="Open the Google Drive folder this chart lives in (the charter's collection)"
                  onClick={() => {
                    window.api.openExternal(song.driveFolderUrl as string)
                    close()
                  }}
                >
                  <Icon name="folder" size={15} /> Open charter&apos;s Google Drive
                </button>
              ) : null}
              {link ? (
                <button
                  className="rowmenu__item"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link)
                    close()
                  }}
                >
                  <Icon name="link" size={15} /> Copy download link
                </button>
              ) : null}
              <button
                className="rowmenu__item"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${song.artist} - ${song.title}`)
                  close()
                }}
              >
                <Icon name="copy" size={15} /> Copy name
              </button>
            </div>
          </>,
          document.body
        )
      : null

  return (
    <div className="rowmenu" onMouseDown={stop} onClick={stop} onDoubleClick={stop}>
      <button
        ref={btnRef}
        type="button"
        className="rowmenu__btn"
        title="More"
        onMouseDown={stop}
        onClick={toggle}
      >
        <Icon name="more" size={18} />
      </button>
      {menu}
    </div>
  )
}
