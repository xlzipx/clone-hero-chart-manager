import { useEffect, useState } from 'react'
import type { ReleaseNotes } from '../../../shared/types'
import { Icon } from './Icon'
import { fmtDate, renderNotes } from './WhatsNew'

const RELEASES_PAGE = 'https://github.com/xlzipx/clone-hero-chart-manager/releases'

// Poznámky k nainstalované verzi: načtou se dopředu při startu appky
// (`preloadReleaseNotes` z App) a drží se tu, takže Nastavení → Updates je
// ukáže hned. Hlavní proces je navíc ukládá na disk (platí i po restartu).
let currentCache: ReleaseNotes | null | undefined // undefined = ještě nenačteno
let currentReq: Promise<ReleaseNotes | null> | null = null

export function preloadReleaseNotes(): Promise<ReleaseNotes | null> {
  if (currentCache) return Promise.resolve(currentCache)
  currentReq ??= window.api
    .getReleaseNotesCurrent()
    .catch(() => null)
    .then((n) => {
      currentCache = n
      currentReq = null
      return n
    })
  return currentReq
}

/**
 * Poznámky k vydání přímo v Nastavení → Updates. Nainstalovaná verze je vidět
 * hned (zvýrazněná), zbytek aktuální řady (např. 1.6.0 → 1.6.5) se stáhne až
 * po rozbalení časové osy. Data = GitHub Releases (jako okno „What's new").
 */
export function UpdateNotes({ version }: { version: string }): JSX.Element {
  const [current, setCurrent] = useState<ReleaseNotes | null | undefined>(currentCache)
  const [rest, setRest] = useState<ReleaseNotes[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (currentCache) return
    let cancelled = false
    void preloadReleaseNotes().then((n) => {
      if (!cancelled) setCurrent(n)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Starší vydání řady se stahují až na rozbalení (a jen jednou).
  useEffect(() => {
    if (!open || rest !== null) return
    let cancelled = false
    window.api
      .getReleaseNotesMilestone()
      .catch(() => [] as ReleaseNotes[])
      .then((list) => {
        if (!cancelled) setRest(list.filter((r) => r.version !== version))
      })
    return () => {
      cancelled = true
    }
  }, [open, rest, version])

  const parts = (version || '').split('.')
  const series = parts.slice(0, 2).join('.')
  // x.y.0 je první vydání řady → nic staršího v ní není.
  const hasEarlier = Number(parts[2]) > 0

  return (
    <section className="stcard stnotes">
      <div className="stnotes__head">
        <h3 className="stcard__title">Release notes</h3>
        <button type="button" className="linkbtn stnotes__gh" onClick={() => window.api.openExternal(RELEASES_PAGE)}>
          All releases on GitHub
        </button>
      </div>

      {current === undefined ? (
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

          {hasEarlier ? (
            <>
              <button
                type="button"
                className={`stnotes__toggle ${open ? 'is-open' : ''}`}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                <span className="stnotes__toggletext">
                  Everything in v{series}
                  {rest?.length ? (
                    <span className="stnotes__count">
                      {rest.length} earlier {rest.length === 1 ? 'release' : 'releases'}
                    </span>
                  ) : null}
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <div className={`stnotes__roll ${open ? 'is-open' : ''}`} aria-hidden={!open}>
                <div className="stnotes__rollinner">
                  {rest === null ? (
                    <div className="stnotes__cur stnotes__cur--loading">
                      <span className="stnotes__skel" style={{ width: '25%' }} />
                      <span className="stnotes__skel" style={{ width: '80%' }} />
                      <span className="stnotes__skel" style={{ width: '65%' }} />
                    </div>
                  ) : !rest.length ? (
                    <p className="stnotes__empty">Earlier releases couldn't be loaded. Read them on GitHub.</p>
                  ) : (
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
                  )}
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
