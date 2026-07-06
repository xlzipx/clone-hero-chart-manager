import { useEffect, useState } from 'react'
import type { ReleaseNotes } from '../../../shared/types'
import { useStore } from '../store'

const RELEASES_PAGE = 'https://github.com/xlzipx/clone-hero-chart-manager/releases'

/** Zvýrazní `**tučné**` v jednom řádku. */
function inline(text: string, key: number): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span key={key}>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : p
      )}
    </span>
  )
}

/**
 * Vykreslí podmnožinu Markdownu z GitHub release notes:
 * `## nadpis`, odrážky `-`/`*`, `> poznámka`, tučné `**text**`, prázdné řádky.
 */
function renderNotes(body: string): JSX.Element[] {
  const lines = body.replace(/\r/g, '').split('\n')
  const out: JSX.Element[] = []
  let list: string[] = []
  const flushList = (): void => {
    if (list.length === 0) return
    const items = [...list]
    out.push(
      <ul className="wn__list" key={`ul-${out.length}`}>
        {items.map((it, i) => (
          <li key={i}>{inline(it, i)}</li>
        ))}
      </ul>
    )
    list = []
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    flushList()
    if (!line.trim()) continue
    if (/^#{1,6}\s+/.test(line)) {
      out.push(
        <h4 className="wn__h" key={`h-${out.length}`}>
          {inline(line.replace(/^#{1,6}\s+/, ''), 0)}
        </h4>
      )
    } else if (/^>\s?/.test(line)) {
      out.push(
        <p className="wn__note" key={`n-${out.length}`}>
          {inline(line.replace(/^>\s?/, ''), 0)}
        </p>
      )
    } else {
      out.push(
        <p className="wn__p" key={`p-${out.length}`}>
          {inline(line, 0)}
        </p>
      )
    }
  }
  flushList()
  return out
}

/** ISO datum → „Jul 6, 2026" (nebo prázdné, když se nepodaří naparsovat). */
function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function WhatsNew(): JSX.Element | null {
  const show = useStore((s) => s.showWhatsNew)
  const since = useStore((s) => s.whatsNewSince)
  const setShow = useStore((s) => s.setShowWhatsNew)
  const [releases, setReleases] = useState<ReleaseNotes[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    setReleases([])
    let cancelled = false
    // Po updatu (since != null): vše novější než minulá verze, max 8.
    // Ruční otevření (since == null): poslední 3 vydání.
    void window.api
      .getReleaseNotesSince(since ?? undefined, since ? 8 : 3)
      .then((list) => {
        if (!cancelled) setReleases(list)
      })
      .catch(() => {
        /* offline → zůstane fallback text */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [show, since])

  if (!show) return null

  // Nadpis: po updatu z konkrétní verze to řekni; při ručním otevření obecně.
  const multi = releases.length > 1
  const title = since && multi ? `What's new since v${since}` : "What's new"
  const newestUrl = releases[0]?.url || RELEASES_PAGE

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setShow(false)
      }}
    >
      <div className="modal modal--whatsnew" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal__body wn__body">
          {loading ? (
            <p className="wn__p wn__muted">Loading release notes…</p>
          ) : releases.length > 0 ? (
            releases.map((rel) => (
              <section className="wn__rel" key={rel.version}>
                <div className="wn__relhead">
                  <h3 className="wn__ver">{rel.name}</h3>
                  {fmtDate(rel.date) && <span className="wn__date">{fmtDate(rel.date)}</span>}
                </div>
                {rel.body.trim() ? (
                  renderNotes(rel.body)
                ) : (
                  <p className="wn__p wn__muted">No release notes.</p>
                )}
              </section>
            ))
          ) : (
            <p className="wn__p wn__muted">
              Release notes could not be loaded. You can view them on GitHub.
            </p>
          )}
        </div>
        <div className="modal__foot">
          <button className="btn-secondary" onClick={() => window.api.openExternal(newestUrl)}>
            View on GitHub
          </button>
          <button className="btn-primary" onClick={() => setShow(false)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
