import { useEffect, useState } from 'react'
import type { ReleaseNotes } from '../../../shared/types'
import { Icon } from './Icon'
import { fmtDate, renderNotes } from './WhatsNew'

const RELEASES_PAGE = 'https://github.com/xlzipx/clone-hero-chart-manager/releases'

/**
 * Poznámky k vydání přímo v Nastavení → Updates. Nainstalovaná verze je vidět
 * hned (zvýrazněná), zbytek aktuální řady (např. 1.6.0 → 1.6.5) se rozbalí na
 * časové ose. Data = stejný zdroj jako okno „What's new" (GitHub Releases).
 */
export function UpdateNotes({ version }: { version: string }): JSX.Element {
  const [releases, setReleases] = useState<ReleaseNotes[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getReleaseNotesMilestone()
      .then((list) => {
        if (!cancelled) setReleases(list)
      })
      .catch(() => {
        if (!cancelled) setReleases([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const series = (version || '').split('.').slice(0, 2).join('.')
  const current = releases?.find((r) => r.version === version) ?? releases?.[0]
  const rest = releases ? releases.filter((r) => r !== current) : []

  return (
    <section className="stcard stnotes">
      <div className="stnotes__head">
        <h3 className="stcard__title">Release notes</h3>
        <button type="button" className="linkbtn stnotes__gh" onClick={() => window.api.openExternal(RELEASES_PAGE)}>
          All releases on GitHub
        </button>
      </div>

      {releases === null ? (
        <div className="stnotes__cur stnotes__cur--loading">
          <span className="stnotes__skel" style={{ width: '30%' }} />
          <span className="stnotes__skel" style={{ width: '85%' }} />
          <span className="stnotes__skel" style={{ width: '70%' }} />
        </div>
      ) : !current ? (
        <p className="stnotes__empty">Release notes couldn't be loaded. Check your connection, or read them on GitHub.</p>
      ) : (
        <>
          <article className="stnotes__cur">
            <div className="stnotes__relhead">
              <span className="stnotes__ver">v{current.version}</span>
              <span className="stnotes__tag">Installed</span>
              {fmtDate(current.date) ? <span className="stnotes__date">{fmtDate(current.date)}</span> : null}
            </div>
            <div className="wn__body stnotes__body">
              {current.body.trim() ? renderNotes(current.body) : <p className="wn__p wn__muted">No release notes.</p>}
            </div>
          </article>

          {rest.length ? (
            <>
              <button
                type="button"
                className={`stnotes__toggle ${open ? 'is-open' : ''}`}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                <span className="stnotes__toggletext">
                  Everything in v{series}
                  <span className="stnotes__count">
                    {rest.length} earlier {rest.length === 1 ? 'release' : 'releases'}
                  </span>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <div className={`stnotes__roll ${open ? 'is-open' : ''}`} aria-hidden={!open}>
                <div className="stnotes__rollinner">
                  <ol className="stnotes__timeline">
                    {rest.map((r) => (
                      <li key={r.version} className="stnotes__item">
                        <div className="stnotes__relhead">
                          <span className="stnotes__ver stnotes__ver--sm">v{r.version}</span>
                          {fmtDate(r.date) ? <span className="stnotes__date">{fmtDate(r.date)}</span> : null}
                        </div>
                        <div className="wn__body stnotes__body">
                          {r.body.trim() ? renderNotes(r.body) : <p className="wn__p wn__muted">No release notes.</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
