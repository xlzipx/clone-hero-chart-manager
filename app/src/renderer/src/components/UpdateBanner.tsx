import { useEffect, useState } from 'react'
import type { UpdateAvailable } from '../../../shared/types'
import { Icon } from './Icon'

const DISMISS_KEY = 'chm.updateDismissed'

/**
 * Pruh s aktualizací. Řízený událostmi z main procesu (electron-updater):
 *   - instalační verze: nabídne stažení na pozadí → průběh → „Restart to install"
 *   - portable / dev: fallback na ruční odkaz „View release"
 * Kontrola i stažení běží v main procesu; tady jen zobrazujeme stav.
 */
export function UpdateBanner(): JSX.Element | null {
  const [info, setInfo] = useState<UpdateAvailable | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const offAvail = window.api.onUpdateAvailable((i) => {
      if (localStorage.getItem(DISMISS_KEY) === i.version) return // tuhle verzi už zavřel
      setInfo(i)
    })
    const offProg = window.api.onUpdateProgress((p) => setPercent(p.percent))
    const offDone = window.api.onUpdateDownloaded(() => {
      setDownloaded(true)
      setBusy(false)
    })
    return () => {
      offAvail()
      offProg()
      offDone()
    }
  }, [])

  if (!info || dismissed) return null

  const dismiss = (): void => {
    localStorage.setItem(DISMISS_KEY, info.version)
    setDismissed(true)
  }
  const download = async (): Promise<void> => {
    setBusy(true)
    setPercent(0)
    try {
      const res = await window.api.downloadUpdate()
      if (!res.ok) {
        setBusy(false)
        setPercent(null)
        window.alert(`Update download failed: ${res.error}`)
      }
    } catch (e) {
      // Reject IPC nesmí nechat banner navěky na „Downloading… 0 %".
      setBusy(false)
      setPercent(null)
      window.alert(`Update download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 1) Stažené a připravené → restart.
  if (downloaded) {
    return (
      <div className="updatebar updatebar--ready">
        <span className="updatebar__icon">
          <Icon name="download" size={15} />
        </span>
        <span className="updatebar__text">
          Update <strong>v{info.version}</strong> is ready. Restart to install it.
        </span>
        <button className="updatebar__btn" onClick={() => void window.api.installUpdate()}>
          Restart &amp; install
        </button>
        <button className="updatebar__close" onClick={dismiss} title="Later">
          <Icon name="close" size={13} />
        </button>
      </div>
    )
  }

  // 2) Stahuje se → průběh.
  if (busy) {
    return (
      <div className="updatebar">
        <span className="updatebar__icon">
          <Icon name="download" size={15} />
        </span>
        <span className="updatebar__text">
          Downloading update <strong>v{info.version}</strong>… {percent ?? 0}%
        </span>
        <div className="updatebar__progress">
          <div className="updatebar__progress-fill" style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>
    )
  }

  // 3) Dostupné — auto (Download) nebo ruční fallback (View release).
  return (
    <div className="updatebar">
      <span className="updatebar__icon">
        <Icon name="download" size={15} />
      </span>
      <span className="updatebar__text">
        A new version <strong>v{info.version}</strong> is available.
      </span>
      {info.canAutoUpdate ? (
        <button className="updatebar__btn" onClick={() => void download()}>
          Download update
        </button>
      ) : (
        <button
          className="updatebar__btn"
          onClick={() => info.url && window.api.openExternal(info.url)}
        >
          View release
        </button>
      )}
      <button className="updatebar__close" onClick={dismiss} title="Dismiss">
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}
