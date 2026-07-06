import { memo, useEffect, useState } from 'react'
import type { DownloadJob, SongResult } from '../../../shared/types'
import {
  detectManualHost,
  formatLabel,
  formatLength,
  type ManualHost
} from '../utils'
import { Icon } from './Icon'
import { InstrumentDifficulty } from './InstrumentDifficulty'
import { RichText } from './RichText'
import { RowMenu } from './RowMenu'

/** Malý komponentový wrapper pro album art — fallback na ikonu při onError. */
function AlbumArt({ url }: { url: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return (
      <div className="song__art-empty">
        <Icon name="note" size={22} />
      </div>
    )
  }
  return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
}

interface Props {
  song: SongResult
  selected: boolean
  job?: DownloadJob
  /** Nápověda: píseň (artist+title) už je v knihovně. */
  owned?: boolean
  /** Multi-select: je řádek zaškrtnutý pro hromadné stažení? */
  checked?: boolean
  /** Multi-select: lze řádek zaškrtnout (auto-stažitelný, nezařazený)? */
  checkable?: boolean
  // Callbacky dostávají klíč písně a rodič si aktuální index/píseň dohledá sám.
  // NESMÍ to být closury nad indexem: memo komparátor callbacky neporovnává,
  // takže po přeřazení výsledků (sort/filtr) by řádek držel starý index a klik
  // by označil/stáhl jinou píseň.
  onToggleCheck?: (key: string) => void
  onSelect: (key: string) => void
  onDownload: (key: string) => void
  onMarketplace: (key: string) => void
}

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  resolving: 'Resolving',
  downloading: 'Downloading',
  extracting: 'Extracting',
  converting: 'Converting',
  installing: 'Installing',
  done: 'Done ✓',
  error: 'Error'
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function manualLabel(host: Exclude<ManualHost, null>): string {
  if (host === 'Shortener') return 'Download manually'
  return `Get on ${host}`
}

function SongRowBase({
  song,
  selected,
  job,
  owned = false,
  checked = false,
  checkable = false,
  onToggleCheck,
  onSelect,
  onDownload,
  onMarketplace
}: Props): JSX.Element {
  const busy = job && job.stage !== 'done' && job.stage !== 'error'
  const pct = job && job.progress >= 0 ? Math.round(job.progress * 100) : null
  // Procenta má smysl ukazovat jen u stahování (jediná fáze se skutečným
  // progressem). Konverze/rozbalování/instalace nemají měřitelný postup —
  // Onyx procenta nehlásí — takže tam ukážeme točící se spinner místo zamrzlého „0%".
  const showPct = job?.stage === 'downloading' && pct !== null
  const showSpin = busy && job?.stage !== 'downloading'
  const size = formatSize(song.sizeBytes)
  const initialHost = detectManualHost(song.source, song.downloadUrl || song.downloadPageUrl)
  const [manualHost, setManualHost] = useState<ManualHost>(initialHost)

  // Pokud je to shortener (bit.ly aj.), rozbalíme na pozadí — finální host
  // (typicky MEGA / Mediafire) pak nahradí obecné "Download manually".
  useEffect(() => {
    if (initialHost !== 'Shortener') return
    const src = song.downloadUrl || song.downloadPageUrl
    if (!src) return
    let cancelled = false
    void (async () => {
      try {
        const finalUrl = await window.api.resolveUrl(src)
        if (cancelled || !finalUrl || finalUrl === src) return
        const resolved = detectManualHost(null, finalUrl)
        if (resolved && resolved !== 'Shortener') setManualHost(resolved)
      } catch {
        /* nevadí, zůstane obecný label */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialHost, song.downloadUrl, song.downloadPageUrl])

  const openExternal = (): void => {
    const url = song.downloadPageUrl || song.downloadUrl || song.externalUrl
    if (url) window.api.openExternal(url)
  }

  return (
    <div
      className={`song ${selected ? 'song--selected' : ''} ${checked ? 'song--checked' : ''}`}
      onClick={() => onSelect(song.key)}
      onDoubleClick={() => onDownload(song.key)}
    >
      <div className="song__check">
        {checkable ? (
          <label className="chk" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleCheck?.(song.key)}
              aria-label={`Select ${song.artist} - ${song.title}`}
            />
            <span className="chk__box">
              <Icon name="check" size={12} />
            </span>
          </label>
        ) : null}
      </div>

      <div className="song__art">
        <AlbumArt url={song.albumArtUrl} />
      </div>

      <div className="song__main">
        <div className="song__title" title={song.title}>
          {song.title}
        </div>
        <div className="song__artist" title={song.artist}>
          {song.artist}
          {song.album ? <span className="song__album"> · {song.album}</span> : null}
          {song.year ? <span className="song__year"> · {song.year}</span> : null}
        </div>
        <div className="song__meta">
          <span className="badge badge--len">{formatLength(song.lengthSeconds)}</span>
          {song.official ? (
            <span className="badge badge--dlc">Official DLC</span>
          ) : (
            <span className={`badge ${song.needsConversion ? 'badge--convert' : 'badge--native'}`}>
              {formatLabel(song.gameFormat)}
              {song.needsConversion ? ' → CH' : ''}
            </span>
          )}
          {song.expertOnly === true ? (
            <span
              className="badge badge--expert"
              title="This chart only has an Expert difficulty (no Easy / Medium / Hard)"
            >
              Expert only
            </span>
          ) : song.expertOnly === false ? (
            <span
              className="badge badge--alldiffs"
              title="This chart has Easy, Medium, Hard and Expert"
            >
              E/M/H/X
            </span>
          ) : null}
          {owned ? (
            <span className="badge badge--owned" title="You already have this song in your library">
              <Icon name="check" size={11} /> In library
            </span>
          ) : null}
          {song.charter ? (
            <span className="song__charter">
              <Icon name="charter" size={12} /> <RichText text={song.charter} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="song__diffs">
        <InstrumentDifficulty difficulties={song.difficulties} />
      </div>

      <div className="song__action">
        {job ? (
          <div className={`jobchip jobchip--${job.stage} ${busy ? 'jobchip--busy' : ''}`}>
            {showSpin ? <span className="jobchip__spin" aria-hidden="true" /> : null}
            <span>{STAGE_LABEL[job.stage] ?? job.stage}</span>
            {showPct ? <span className="jobchip__pct">{pct}%</span> : null}
            {job.stage === 'error' ? (
              <span className="jobchip__err" title={job.error}>
                ⚠
              </span>
            ) : null}
          </div>
        ) : song.official ? (
          <button
            className="dl-btn dl-btn--store"
            title="Official DLC — open the store page in your browser"
            onClick={(e) => {
              e.stopPropagation()
              onMarketplace(song.key)
            }}
          >
            <Icon name="external" size={14} /> Open store
          </button>
        ) : manualHost ? (
          <button
            className="dl-btn dl-btn--store"
            title={
              manualHost === 'Shortener'
                ? 'Shortened link — open in browser, then drop the downloaded file into the drop zone above'
                : `Hosted on ${manualHost} — open in browser, then drop the downloaded file into the drop zone above`
            }
            onClick={(e) => {
              e.stopPropagation()
              openExternal()
            }}
          >
            <Icon name="external" size={14} /> {manualLabel(manualHost)}
          </button>
        ) : (
          <>
            <button
              className="dl-btn"
              onClick={(e) => {
                e.stopPropagation()
                onDownload(song.key)
              }}
            >
              <Icon name="download" size={14} /> Download
            </button>
            {size ? <span className="song__size">{size}</span> : null}
          </>
        )}
      </div>

      <RowMenu song={song} />
    </div>
  )
}

/**
 * Memo s explicitním porovnáním – řádky se re-renderují JEN když se mění:
 * job (stage / progress), selected nebo identita songu. To dramaticky snižuje
 * zbytečné rerendery při běžícím downloadu (jobs:update přijde každé 1 %).
 */
export const SongRow = memo(SongRowBase, (prev, next) => {
  if (prev.song.key !== next.song.key) return false
  if (prev.selected !== next.selected) return false
  if (prev.owned !== next.owned) return false
  if (prev.checked !== next.checked) return false
  if (prev.checkable !== next.checkable) return false
  if (prev.job?.id !== next.job?.id) return false
  if (prev.job?.stage !== next.job?.stage) return false
  if (prev.job?.progress !== next.job?.progress) return false
  if (prev.job?.error !== next.job?.error) return false
  return true
})
