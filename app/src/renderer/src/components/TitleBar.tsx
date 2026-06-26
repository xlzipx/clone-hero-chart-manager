import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

type Game = 'clone-hero' | 'yarg' | null

function gameName(g: Exclude<Game, null>): string {
  return g === 'yarg' ? 'YARG' : 'Clone Hero'
}

interface LaunchBtnProps {
  game: Exclude<Game, null>
  runningGame: Game
  onLaunch: (game: Exclude<Game, null>) => void
  busy: boolean
}

function LaunchBtn({ game, runningGame, onLaunch, busy }: LaunchBtnProps): JSX.Element {
  const isThisRunning = runningGame === game
  const label = busy
    ? 'Working…'
    : isThisRunning
      ? `Switch to ${gameName(game)}`
      : `Launch ${gameName(game)}`
  const title = isThisRunning
    ? `${gameName(game)} is running — click to bring it to the front`
    : `Launch ${gameName(game)}`

  return (
    <button
      className={`gamebtn ${isThisRunning ? 'gamebtn--running' : ''} ${
        busy ? 'gamebtn--busy' : ''
      }`}
      title={title}
      onClick={() => onLaunch(game)}
      disabled={busy}
    >
      <span className={`gamebtn__dot ${isThisRunning ? 'gamebtn__dot--on' : ''}`} />
      <Icon name="gamepad" size={16} />
      <span className="gamebtn__label">{label}</span>
    </button>
  )
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

  const launchGame = async (game: Exclude<Game, null>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.bringGameToFront(game)
      if (!res.ok) {
        window.alert(res.error)
      } else if (!runningGame && res.game) {
        // Po spuštění obvykle trvá pár sekund než se objeví v procesech.
        setRunningGame(res.game)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="titlebar">
      <div className="titlebar__left">
        <LaunchBtn
          game="clone-hero"
          runningGame={runningGame}
          onLaunch={launchGame}
          busy={busy}
        />
        <LaunchBtn game="yarg" runningGame={runningGame} onLaunch={launchGame} busy={busy} />
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
