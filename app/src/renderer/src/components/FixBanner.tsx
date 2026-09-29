import { useEffect } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Pruh nad hledáním pro „Fix it" z Library: připomíná, kterou rozbitou
 * složku příští stažení nahradí, a pak ohlásí výsledek.
 */
export function FixBanner(): JSX.Element | null {
  const target = useStore((s) => s.fixTarget)
  const jobs = useStore((s) => s.fixJobs)
  const notice = useStore((s) => s.fixNotice)
  const cancelFix = useStore((s) => s.cancelFix)
  const dismiss = useStore((s) => s.dismissFixNotice)
  const loose = useStore((s) => s.fixLoose)
  const doneRel = useStore((s) => s.fixDoneRel)
  const openLibraryAt = useStore((s) => s.openLibraryAt)
  const running = Object.values(jobs)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismiss, 8000)
    return () => clearTimeout(t)
  }, [notice, dismiss])

  if (target) {
    return (
      <div className="fixbar" role="status">
        <Icon name="alert" size={15} />
        <span>
          Fixing <strong>{target.name}</strong>.{' '}
          {loose
            ? `No version by ${target.artist} found, showing every song called “${target.title}”.`
            : 'Pick a version below and click Download, it will replace the broken folder.'}
        </span>
        <button type="button" className="fixbar__btn" onClick={cancelFix}>
          Cancel
        </button>
      </div>
    )
  }
  if (running.length) {
    return (
      <div className="fixbar fixbar--busy" role="status">
        <i className="fixbar__spin" aria-hidden="true" />
        <span>
          Downloading a replacement for <strong>{running[0].name}</strong>
          {running.length > 1 ? ` and ${running.length - 1} more` : ''}…
        </span>
      </div>
    )
  }
  if (notice) {
    return (
      <div className="fixbar fixbar--done" role="status">
        <Icon name="check" size={15} />
        <span>{notice}</span>
        {doneRel ? (
          <button
            type="button"
            className="fixbar__btn"
            onClick={() => {
              openLibraryAt([doneRel])
              dismiss()
            }}
          >
            Show in library
          </button>
        ) : null}
        <button type="button" className="fixbar__btn" onClick={dismiss}>
          OK
        </button>
      </div>
    )
  }
  return null
}
