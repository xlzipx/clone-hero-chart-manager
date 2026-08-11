import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

/** Sekundy → „m:ss". */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function searchUrl(kind: 'spotify' | 'youtube', artist: string, title: string): string {
  const q = encodeURIComponent(`${artist} ${title}`.trim())
  return kind === 'spotify'
    ? `https://open.spotify.com/search/${q}`
    : `https://www.youtube.com/results?search_query=${q}`
}

/**
 * Přehrávač knihovny („Listen as a playlist"). Spodní lišta s aktuální písní,
 * ovládáním a rozklikávací frontou. Zvuk řeší store (mix stop z `chm-audio://`).
 */
export function PlayerBar(): JSX.Element {
  const player = useStore((s) => s.player)
  const toggle = useStore((s) => s.playerToggle)
  const next = useStore((s) => s.playerNext)
  const prev = useStore((s) => s.playerPrev)
  const seek = useStore((s) => s.playerSeek)
  const playPos = useStore((s) => s.playerPlayPos)
  const toggleShuffle = useStore((s) => s.playerToggleShuffle)
  const cycleRepeat = useStore((s) => s.playerCycleRepeat)
  const sortQueue = useStore((s) => s.playerSortQueue)
  const setVolume = useStore((s) => s.playerSetVolume)
  const toggleNormalize = useStore((s) => s.playerToggleNormalize)
  const close = useStore((s) => s.playerClose)
  const [queueOpen, setQueueOpen] = useState(false)
  // Hlasitost před ztlumením — aby klik na ikonu vrátil původní úroveň.
  const lastVol = useRef(1)

  // Přehrávač je VŽDY v DOM (jen sbalený roletou), aby šel plynule vyjet/zajet.
  const active = player.active
  useEffect(() => {
    if (!active) setQueueOpen(false)
  }, [active])

  const muted = player.volume === 0
  const toggleMute = (): void => {
    if (player.volume > 0) {
      lastVol.current = player.volume
      setVolume(0)
    } else {
      setVolume(lastVol.current || 1)
    }
  }

  const cur = player.queue[player.order[player.pos]]
  const frac = player.duration > 0 ? Math.min(1, player.time / player.duration) : 0
  const loading = player.state === 'loading'

  const onSeek = (e: React.MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    seek((e.clientX - r.left) / r.width)
  }

  const open = (url: string): void => window.api.openExternal(url)

  return (
    <div
      className={`player ${active ? 'player--active' : ''} ${
        player.state === 'playing' ? 'player--playing' : ''
      }`}
    >
      <div className="player__stack">
      {/* Fronta = IN-FLOW roleta (grid-rows 0fr↔1fr), přesně jako lišta. ŽÁDNÝ
          `position: absolute` ani `transform` — ty při UI scale ≠ 100 % rozhazují
          hit-test (klik dopadá mimo text). Fronta roluje nad lištou, lišta se nehýbe. */}
      <div className={`player__queueroll ${queueOpen && active ? 'player__queueroll--open' : ''}`}>
        <div className="player__queue">
          <div className="player__queuehead">
            <span className="player__queuetitle">
              <Icon name="playlist" size={14} /> {player.label}
            </span>
            <span className="player__queuecount">{player.queue.length} songs</span>
          </div>
          {/* Hlavička sloupců — klikatelné řazení (# = pořadí ze složky, jinak
              podle názvu/umělce). Při zamíchání se aktivní sloupec nezvýrazňuje. */}
          <div className="player__qcols">
            {(
              [
                ['index', '#', 'player__qcol-idx'],
                ['title', 'Title', ''],
                ['artist', 'Artist', '']
              ] as const
            ).map(([col, label, cls]) => {
              const on = !player.shuffle && player.sortBy === col
              return (
                <button
                  key={col}
                  type="button"
                  className={`player__qcolbtn ${cls} ${on ? 'player__qcolbtn--on' : ''}`}
                  onClick={() => sortQueue(col)}
                  title={`Sort by ${label === '#' ? 'folder order' : label.toLowerCase()}`}
                >
                  {label}
                  <span className="player__qsort" aria-hidden="true">
                    {on ? (player.sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="player__queuelist">
            {player.order.map((qi, i) => {
              const t = player.queue[qi]
              const on = i === player.pos
              return (
                <button
                  key={`${t.rel}#${i}`}
                  type="button"
                  className={`player__qrow ${on ? 'player__qrow--on' : ''}`}
                  onClick={() => void playPos(i)}
                  title={`${t.artist} — ${t.title}`}
                >
                  <span className="player__qidx">
                    {on ? (
                      <span className="player__eq" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="player__qtitle">{t.title}</span>
                  <span className="player__qartist">{t.artist || 'Unknown artist'}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Lišta = roleta: klip-wrapper ořízne obsah, když zajede (player--active). */}
      <div className="player__barclip">
      <div className="player__bar">
        {/* Aktuální píseň */}
        <div className="player__now">
          <div className="player__art">
            {player.art ? <img src={player.art} alt="" /> : <Icon name="note" size={20} />}
          </div>
          <div className="player__meta">
            <div className="player__title" title={cur?.title}>
              {cur?.title ?? '—'}
            </div>
            <div className="player__artist" title={cur?.artist}>
              {cur?.artist || 'Unknown artist'}
            </div>
          </div>
          {cur ? (
            <div className="player__links">
              <button
                type="button"
                className="player__link player__link--spotify"
                title="Search on Spotify"
                onClick={() => open(searchUrl('spotify', cur.artist, cur.title))}
              >
                Spotify
              </button>
              <button
                type="button"
                className="player__link player__link--youtube"
                title="Search on YouTube"
                onClick={() => open(searchUrl('youtube', cur.artist, cur.title))}
              >
                YouTube
              </button>
            </div>
          ) : null}
        </div>

        {/* Ovládání + seek */}
        <div className="player__center">
          <div className="player__controls">
            <button
              type="button"
              className={`player__ctl ${player.shuffle ? 'player__ctl--on' : ''}`}
              title="Shuffle"
              onClick={toggleShuffle}
            >
              <Icon name="shuffle" size={16} />
            </button>
            <button type="button" className="player__ctl" title="Previous" onClick={prev}>
              <Icon name="skipBack" size={18} />
            </button>
            <button
              type="button"
              className="player__play"
              title={player.state === 'playing' ? 'Pause' : 'Play'}
              onClick={toggle}
              disabled={loading}
            >
              {loading ? (
                <span className="player__spin" aria-hidden="true" />
              ) : (
                <Icon name={player.state === 'playing' ? 'pause' : 'play'} size={18} />
              )}
            </button>
            <button type="button" className="player__ctl" title="Next" onClick={next}>
              <Icon name="skipForward" size={18} />
            </button>
            <button
              type="button"
              className={`player__ctl ${player.repeat !== 'off' ? 'player__ctl--on' : ''}`}
              title={
                player.repeat === 'one'
                  ? 'Repeat one'
                  : player.repeat === 'all'
                    ? 'Repeat all'
                    : 'Repeat off'
              }
              onClick={cycleRepeat}
            >
              <Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={16} />
            </button>
          </div>
          <div className="player__seekrow">
            <span className="player__time">{fmt(player.time)}</span>
            <div className="player__seek" onClick={onSeek}>
              <div className="player__seekfill" style={{ width: `${frac * 100}%` }} />
            </div>
            <span className="player__time">{fmt(player.duration)}</span>
          </div>
        </div>

        {/* Hlasitost + fronta + zavřít */}
        <div className="player__right">
          <button
            type="button"
            className={`player__ctl ${player.normalize ? 'player__ctl--on' : ''}`}
            title={
              player.normalize
                ? 'Volume matching on — songs play at an even loudness (dynamics kept)'
                : 'Volume matching off — songs play at their original loudness'
            }
            onClick={toggleNormalize}
          >
            <Icon name="levels" size={16} />
          </button>
          <div className="player__vol">
            <button
              type="button"
              className="player__ctl"
              title={muted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
            >
              <Icon name={muted ? 'volumeMute' : 'volume'} size={17} />
            </button>
            <input
              className="player__volslider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ '--v': `${player.volume * 100}%` } as React.CSSProperties}
              aria-label="Volume"
              title="Volume"
            />
          </div>
          <button
            type="button"
            className={`player__ctl ${queueOpen ? 'player__ctl--on' : ''}`}
            title="Queue"
            onClick={() => setQueueOpen((o) => !o)}
          >
            <Icon name="playlist" size={17} />
            <span className="player__qn">{player.pos + 1}/{player.queue.length}</span>
          </button>
          <button type="button" className="player__ctl" title="Close player" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      </div>
      </div>
    </div>
  )
}
