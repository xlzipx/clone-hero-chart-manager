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

export function WhatsNew(): JSX.Element | null {
  const show = useStore((s) => s.showWhatsNew)
  const setShow = useStore((s) => s.setShowWhatsNew)
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!show) return
    setLoading(true)
    setNotes(null)
    let cancelled = false
    void window.api
      .getReleaseNotes()
      .then((n) => {
        if (!cancelled) setNotes(n)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [show])

  if (!show) return null

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setShow(false)
      }}
    >
      <div className="modal modal--whatsnew" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{notes ? notes.name : "What's new"}</h2>
          <button className="modal__close" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>
        <div className="modal__body wn__body">
          {loading ? (
            <p className="wn__p wn__muted">Loading release notes…</p>
          ) : notes && notes.body.trim() ? (
            renderNotes(notes.body)
          ) : (
            <p className="wn__p wn__muted">
              Release notes could not be loaded. You can view them on GitHub.
            </p>
          )}
        </div>
        <div className="modal__foot">
          <button
            className="btn-secondary"
            onClick={() => window.api.openExternal(notes?.url || RELEASES_PAGE)}
          >
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
