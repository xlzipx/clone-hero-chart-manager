import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

type Game = 'clone-hero' | 'yarg' | null

function gameName(g: Game): string {
  if (g === 'yarg') return 'YARG'
  return 'Clone Hero'
}

export function TitleBar(): JSX.Element {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setShowLibrary = useStore((s) => s.setShowLibrary)

  const [runningGame, setRunningGame] = useState<Game>(null)
  const [busy, setBusy] = useState(false)

  // Init + subscribe na změny stavu hry.
  useEffect(() => {
    void window.api.runningGame().then(setRunningGame)
    const off = window.api.onGameStatus(setRunningGame)
    return off
  }, [])

  const onClickGame = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      // Když nějaká hra běží, přepneme na ni (její název). Když ne, spustí CH.
      const res = await window.api.bringGameToFront(runningGame ?? 'clone-hero')
      if (!res.ok) window.alert(res.error)
      else if (!runningGame && res.game) {
        // Po spuštění obvykle trvá pár sekund než se objeví v procesech.
        setRunningGame(res.game)
      }
    } finally {
      setBusy(false)
    }
  }

  const isRunning = runningGame !== null
  const label = busy
    ? 'Working…'
    : isRunning
      ? `Switch to ${gameName(runningGame)}`
      : 'Launch Clone Hero'
  const title = isRunning
    ? `${gameName(runningGame)} is running — click to bring it to the front`
    : 'Launch Clone Hero'

  return (
    <div className="titlebar">
      <div className="titlebar__left">
        <button
          className={`gamebtn ${isRunning ? 'gamebtn--running' : ''} ${
            busy ? 'gamebtn--busy' : ''
          }`}
          title={title}
          onClick={onClickGame}
          disabled={busy}
        >
          <span className={`gamebtn__dot ${isRunning ? 'gamebtn__dot--on' : ''}`} />
          <Icon name="gamepad" size={16} />
          <span className="gamebtn__label">{label}</span>
        </button>
      </div>

      <div className="titlebar__brand">
        <h1 className="brand" aria-label="Clone Hero Chart Manager">
          <span className="brand__ch">
            <span className="brand__ch-c">C</span>
            <span className="brand__ch-h">H</span>
            <span className="brand__ch-sub" aria-hidden="true">
              Clone Hero
            </span>
          </span>
          <span className="brand__rest">ART&nbsp;MANAGER</span>
        </h1>
      </div>

      <div className="titlebar__actions">
        <button
          className="titlebar__btn"
          title="Library manager"
          onClick={() => setShowLibrary(true)}
        >
          <Icon name="folder" size={16} />
        </button>
        <button className="titlebar__btn" title="Settings" onClick={() => setShowSettings(true)}>
          <Icon name="settings" size={16} />
        </button>
        <button
          className="titlebar__btn"
          title="Hide window"
          onClick={() => window.api.hideOverlay()}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          className="titlebar__btn titlebar__btn--close"
          title="Quit program"
          onClick={() => window.api.quitApp()}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  )
}
