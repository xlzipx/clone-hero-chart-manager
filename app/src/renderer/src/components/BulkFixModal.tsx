import { useEffect, useMemo, useRef, useState } from 'react'
import type { SongResult } from '../../../shared/types'
import { findChartVersions, songFromFolderName } from '../chartmatch'
import { useStore } from '../store'
import { formatDownloads, isAutoDownloadable, stripTags } from '../utils'
import { Icon } from './Icon'
import { PlInstruments, chartLabel, externalHint, openChartExternal, unavailableTag } from './PlaylistImportModal'

// Hromadná oprava rozbitých písní: ke každé rozbité složce se v obou databázích
// najde náhrada (interpret + název ze song.ini, jinak z názvu složky), uživatel
// zkontroluje návrhy a jedním tlačítkem je stáhne. Každé stažení pak svou
// rozbitou složku nahradí (store.startBulkFix → applyJobUpdate). Vzhled i
// výběr verzí jsou stejné jako u importu Spotify playlistu.

type Status = 'pending' | 'searching' | 'matched' | 'notfound'
interface Row {
  rel: string
  name: string
  artist: string
  title: string
  status: Status
  charts: SongResult[]
  chosen: number
  selected: boolean
}

const CONCURRENCY = 3
const parentOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')

export function BulkFixModal(): JSX.Element | null {
  const items = useStore((s) => s.bulkFix)
  const close = useStore((s) => s.closeBulkFix)
  const startBulkFix = useStore((s) => s.startBulkFix)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const runId = useRef(0)

  const patchRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  useEffect(() => {
    if (!items) {
      runId.current++
      setRows([])
      setExpanded(null)
      return
    }
    const mine = ++runId.current
    setBusy(true)
    void (async () => {
      // Interpret/název/charter ze song.ini (kde je), jinak z názvu složky.
      let infos: Record<string, { title: string; artist: string; charter: string }> = {}
      try {
        const got = await window.api.libSongInfo(items.map((i) => i.rel))
        infos = Object.fromEntries(got.map((g) => [g.rel, g]))
      } catch {
        /* jen podle názvů složek */
      }
      if (runId.current !== mine) return
      const base: (Row & { charter: string })[] = items.map((it) => {
        const ini = infos[it.rel]
        const fromName = songFromFolderName(it.name)
        const useIni = !!ini && !!stripTags(ini.title).trim() && !!stripTags(ini.artist).trim()
        return {
          rel: it.rel,
          name: it.name,
          artist: useIni ? stripTags(ini.artist) : fromName.artist,
          title: useIni ? stripTags(ini.title) : fromName.title,
          charter: ini?.charter ?? '',
          status: 'pending',
          charts: [],
          chosen: 0,
          selected: false
        }
      })
      setRows(base)
      // Náhradu hledáme v OBOU databázích, bez ohledu na přepínač v hledání.
      const db = 'both' as const
      let next = 0
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++
          if (i >= base.length || runId.current !== mine) return
          patchRow(i, { status: 'searching' })
          const b = base[i]
          const charts = b.title ? await findChartVersions(b.artist || b.title, b.title, db, b.charter) : []
          if (runId.current !== mine) return
          patchRow(i, {
            status: charts.length ? 'matched' : 'notfound',
            charts,
            chosen: 0,
            selected: charts.length > 0 && isAutoDownloadable(charts[0])
          })
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      if (runId.current !== mine) return
      // Druhou kopii se stejnou náhradou ve stejné složce rovnou odškrtni.
      setRows((rs) => {
        const seen = new Set<string>()
        return rs.map((r) => {
          const c = r.charts[r.chosen]
          if (r.status !== 'matched' || !c || !r.selected) return r
          const k = parentOf(r.rel) + '|' + c.key
          if (seen.has(k)) return { ...r, selected: false }
          seen.add(k)
          return r
        })
      })
      setBusy(false)
    })()
  }, [items])

  // Dvě rozbité kopie ve stejné složce se stejnou náhradou: stáhnout jen jednou
  // (jinak by v knihovně vznikl duplikát). Druhá zůstane nezaškrtnutá.
  const dupOf = useMemo(() => {
    const seen = new Map<string, number>()
    const out: Record<number, number> = {}
    rows.forEach((r, i) => {
      const c = r.charts[r.chosen]
      if (r.status !== 'matched' || !c) return
      const k = parentOf(r.rel) + '|' + c.key
      const first = seen.get(k)
      if (first !== undefined) out[i] = first
      else if (r.selected) seen.set(k, i)
    })
    return out
  }, [rows])

  if (!items) return null

  const matched = rows.filter((r) => r.status === 'matched')
  const resolved = rows.filter((r) => r.status === 'matched' || r.status === 'notfound').length
  const toFix = rows
    .map((r, i) => ({ r, i, c: r.charts[r.chosen] }))
    .filter(({ r, i, c }) => r.status === 'matched' && r.selected && c && isAutoDownloadable(c) && dupOf[i] === undefined)
  const selectable = matched.filter((r) => isAutoDownloadable(r.charts[r.chosen]))
  const allSelected = selectable.length > 0 && selectable.every((r) => r.selected)

  const toggleAll = (): void =>
    setRows((rs) =>
      rs.map((r) => (r.status === 'matched' && isAutoDownloadable(r.charts[r.chosen]) ? { ...r, selected: !allSelected } : r))
    )

  const doFix = (): void => {
    void startBulkFix(toFix.map(({ r, c }) => ({ rel: r.rel, name: r.name, song: c })))
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal modal--playlist" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>
            <Icon name="alert" size={18} /> Fix broken songs
          </h2>
          <button className="modal__close" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal__body plimport__body">
          <div className="plimport__status">
            <div className="plimport__title">
              <strong>
                {rows.length} broken {rows.length === 1 ? 'song' : 'songs'}
              </strong>
              <span className="plimport__count">
                {busy ? `searching ${resolved}/${rows.length}…` : `replacement found for ${matched.length} of ${rows.length}`}
              </span>
            </div>
            {selectable.length > 0 ? (
              <button className="plimport__selall" onClick={toggleAll}>
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            ) : null}
          </div>
          {busy ? (
            <div className="plimport__progress">
              <div className="plimport__progress-fill" style={{ width: `${rows.length ? (resolved / rows.length) * 100 : 0}%` }} />
            </div>
          ) : null}
          <p className="plimport__note bulkfix__note">
            Each download replaces its broken folder, which is then deleted (to the Recycle Bin or permanently, as set in Settings). Check the suggested versions before you start.
          </p>

          <div className="plimport__list">
            {rows.map((r, i) => {
              const chart = r.charts[r.chosen]
              const dl = chart ? isAutoDownloadable(chart) : false
              const dup = dupOf[i]
              return (
                <div key={r.rel} className={`plrow plrow--${r.status}`}>
                  <div className="plrow__lead">
                    {r.status === 'matched' ? (
                      dl ? (
                        <label className="chk" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={r.selected} onChange={() => patchRow(i, { selected: !r.selected })} />
                          <span className="chk__box">
                            <Icon name="check" size={12} />
                          </span>
                        </label>
                      ) : (
                        <span className="chk chk--disabled" aria-hidden="true">
                          <span className="chk__box" />
                        </span>
                      )
                    ) : r.status === 'notfound' ? (
                      <span className="plrow__x">
                        <Icon name="close" size={12} />
                      </span>
                    ) : (
                      <span className="plimport__spin plrow__spin" />
                    )}
                  </div>

                  <div className="plrow__track">
                    <div className="plrow__title" title={r.rel}>
                      {r.title || r.name}
                    </div>
                    <div className="plrow__artist">
                      <span className="plrow__aname">{r.artist || 'Unknown artist'}</span>
                      {r.status === 'matched' && chart ? (
                        <>
                          {chart.charter ? <span className="plrow__meta">{stripTags(chart.charter)}</span> : null}
                          {chart.downloads != null && chart.downloads > 0 ? (
                            <span className="plrow__meta plrow__meta--dls">
                              <Icon name="download" size={10} /> {formatDownloads(chart.downloads)}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      {parentOf(r.rel) ? <span className="plrow__meta bulkfix__dir">in {parentOf(r.rel)}</span> : null}
                    </div>
                  </div>

                  <div className="plrow__match">
                    {r.status === 'matched' && chart ? (
                      <>
                        {dup !== undefined ? (
                          <span className="bulkfix__dup" title="Another broken copy in this folder gets the same chart, so this one is skipped">
                            Same as copy above
                          </span>
                        ) : null}
                        {dl ? (
                          <span className={`badge ${chart.needsConversion ? 'badge--convert' : 'badge--native'}`}>{chartLabel(chart)}</span>
                        ) : (
                          <button className="plrow__na" title={externalHint(chart)} onClick={() => openChartExternal(chart)}>
                            {unavailableTag(chart) ?? 'Manual'}
                            <Icon name="external" size={10} />
                          </button>
                        )}
                        <PlInstruments difficulties={chart.difficulties} />
                        {r.charts.length > 1 ? (
                          <button className="plrow__versions" onClick={() => setExpanded(expanded === i ? null : i)}>
                            {r.charts.length} versions
                            <Icon name="caret" size={12} />
                          </button>
                        ) : null}
                      </>
                    ) : r.status === 'notfound' ? (
                      <span className="plrow__none">No replacement found</span>
                    ) : r.status === 'searching' ? (
                      <span className="plrow__none">searching…</span>
                    ) : null}
                  </div>

                  {expanded === i && r.charts.length > 1 ? (
                    <div className="plrow__picker">
                      {r.charts.map((c, ci) => (
                        <button
                          key={`${c.key}#${ci}`}
                          className={`plver ${ci === r.chosen ? 'plver--on' : ''}`}
                          title={isAutoDownloadable(c) ? undefined : externalHint(c)}
                          onClick={() => {
                            if (isAutoDownloadable(c)) {
                              patchRow(i, { chosen: ci, selected: true })
                              setExpanded(null)
                            } else openChartExternal(c)
                          }}
                        >
                          <span className="plver__radio">{ci === r.chosen ? '●' : '○'}</span>
                          {isAutoDownloadable(c) ? (
                            <span className={`badge ${c.needsConversion ? 'badge--convert' : 'badge--native'}`}>{chartLabel(c)}</span>
                          ) : (
                            <span className="plrow__na">
                              {unavailableTag(c) ?? 'Manual'}
                              <Icon name="external" size={10} />
                            </span>
                          )}
                          <span className="plver__charter">{c.charter ? stripTags(c.charter) : 'Unknown charter'}</span>
                          <PlInstruments difficulties={c.difficulties} />
                          {c.downloads != null && c.downloads > 0 ? (
                            <span className="plrow__dls">
                              <Icon name="download" size={11} /> {formatDownloads(c.downloads)}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="modal__foot plimport__foot">
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <div className="plimport__footright">
            <span className="plimport__selcount">{toFix.length} selected</span>
            <button className="btn-primary" onClick={doFix} disabled={toFix.length === 0}>
              <Icon name="download" size={14} /> Fix {toFix.length} {toFix.length === 1 ? 'song' : 'songs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
