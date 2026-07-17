import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  resolving: 'Resolving',
  downloading: 'Downloading',
  extracting: 'Extracting',
  converting: 'Converting',
  installing: 'Installing',
  done: 'Done',
  error: 'Error',
  canceled: 'Canceled'
}

// Úloha, kterou lze ještě zrušit (běží nebo čeká) — má křížek + počítá se do „active".
const CANCELABLE = new Set(['queued', 'resolving', 'downloading', 'extracting', 'converting'])
// Terminální stav (žádná další práce) — počítá se do „finished" pro Clear history.
const TERMINAL = new Set(['done', 'error', 'canceled'])

export function DownloadQueue(): JSX.Element | null {
  const jobs = useStore((s) => s.jobs)
  const clearFinishedJobs = useStore((s) => s.clearFinishedJobs)
  const cancelJob = useStore((s) => s.cancelJob)
  const cancelAllJobs = useStore((s) => s.cancelAllJobs)
  const [open, setOpen] = useState(true)
  // ID úloh, u kterých uživatel klikl zrušit, ale běžící krok (konverze) ještě
  // dobíhá. Dává OKAMŽITOU zpětnou vazbu „Canceling…", než dorazí finální stav
  // z main procesu — jinak by se po kliknutí zdánlivě nic nedělo.
  const [canceling, setCanceling] = useState<Set<string>>(new Set())
  const markCanceling = (ids: string[]): void =>
    setCanceling((prev) => new Set([...prev, ...ids]))
  const list = useMemo(() => Object.values(jobs).reverse(), [jobs])
  const shouldShow = list.length > 0

  // Plynulé vysunutí/zasunutí zespodu (grid-template-rows 0fr↔1fr). Při zavírání
  // držíme poslední obsah (snapshot), ať lišta při zajíždění není prázdná, a
  // odmountujeme až po dojetí animace.
  const [rendered, setRendered] = useState(shouldShow)
  const [shown, setShown] = useState(shouldShow)
  const lastList = useRef(list)
  if (shouldShow) lastList.current = list

  useEffect(() => {
    if (shouldShow) {
      setRendered(true)
      // Dvojitý rAF: napřed se vykreslí zavřený stav (0fr), pak teprve otevřeme
      // → transition 0fr→1fr reálně proběhne (jinak by to skočilo).
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const t = setTimeout(() => setRendered(false), 380)
    return () => clearTimeout(t)
  }, [shouldShow])

  if (!rendered) return null

  const display = shouldShow ? list : lastList.current
  const active = display.filter((j) => !TERMINAL.has(j.stage)).length
  const finished = display.length - active
  const anyDone = display.some((j) => j.stage === 'done')

  return (
    <div className={`queue-wrap ${shown ? 'queue-wrap--open' : ''}`}>
      <div className="queue-inner">
        <div className={`queue ${open ? 'queue--open' : ''}`}>
      <div className="queue__header">
        <button className="queue__toggle" onClick={() => setOpen((v) => !v)}>
          <span>Download queue</span>
          <span className="queue__count">
            {active > 0 ? `${active} active` : `${display.length} done`}
          </span>
          <Icon
            name="caret"
            size={14}
            className="queue__chevron"
            style={{ transform: open ? 'none' : 'rotate(180deg)' }}
          />
        </button>
        {active > 0 ? (
          <button
            className="queue__clear queue__stopall"
            title="Cancel all downloads still in progress"
            onClick={() => {
              markCanceling(display.filter((j) => !TERMINAL.has(j.stage)).map((j) => j.id))
              void cancelAllJobs()
            }}
          >
            <Icon name="close" size={13} /> Stop all
          </button>
        ) : null}
        {finished > 0 ? (
          <button
            className="queue__clear"
            title="Clear finished downloads"
            onClick={() => void clearFinishedJobs()}
          >
            <Icon name="trash" size={13} /> Clear history
          </button>
        ) : null}
      </div>
      {open && anyDone ? (
        <div className="queue__rescan">
          <span>New songs appear in-game after you scan the library (Settings → Scan Songs).</span>
        </div>
      ) : null}
      {open ? (
        <div className="queue__list">
          {display.map((job) => {
            // „Canceling" = uživatel klikl zrušit, ale krok ještě dobíhá (job
            // není terminální). Ukáž to hned, i než dorazí finální stav z main.
            const isCanceling = canceling.has(job.id) && !TERMINAL.has(job.stage)
            return (
            <div className={`qjob qjob--${job.stage} ${isCanceling ? 'qjob--canceling' : ''}`} key={job.id}>
              <div className="qjob__top">
                <span className="qjob__title">
                  {job.song.artist} – {job.song.title}
                </span>
                <span className="qjob__stage">
                  {isCanceling ? 'Canceling…' : STAGE_LABEL[job.stage] ?? job.stage}
                </span>
                {CANCELABLE.has(job.stage) && !isCanceling ? (
                  <button
                    className="qjob__cancel"
                    title="Cancel this download"
                    onClick={() => {
                      markCanceling([job.id])
                      void cancelJob(job.id)
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : null}
              </div>
              <div className="qjob__bar">
                <div
                  className="qjob__fill"
                  style={{
                    width: job.progress >= 0 ? `${Math.round(job.progress * 100)}%` : '100%',
                    opacity: job.progress >= 0 ? 1 : 0.4
                  }}
                />
              </div>
              {job.message ? <div className="qjob__msg">{job.message}</div> : null}
              {job.error ? <div className="qjob__err">⚠ {job.error}</div> : null}
            </div>
            )
          })}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  )
}
