import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DupExtras, DupGroup, DupSong, LibEntry, LibProblem, LibSongInfo } from '../../../shared/types'
import { userMsg } from '../../../shared/errors'
import { songFromFolderName } from '../chartmatch'
import { useStore } from '../store'
import { INSTRUMENTS, deleteWords, formatLength, stripTags } from '../utils'
import { IS_MAC } from '../platform'
import { Icon } from './Icon'
import { PlInstruments } from './PlaylistImportModal'
import { RichText } from './RichText'
import { isRowClick, noShiftSelect, setInSet, useChecklistKeys, useRangeToggle } from '../rangeToggle'
import { SongArt, ToolHead, forgetSongExtras, useSongExtras } from './SetlistsView'

// Duplicity a rozbité písně jako plnohodnotná obrazovka knihovny (dřív modální
// okno). Kopie jedné písně stojí vedle sebe jako karty s obalem, ukázkou,
// obtížnostmi a „co má navíc", ať jde snadno vybrat, kterou si nechat.

const EXTRA_META: { key: keyof DupExtras; label: string; title: string }[] = [
  { key: 'stems', label: 'Stems', title: 'Separate instrument audio tracks (you can mute your own part)' },
  { key: 'video', label: 'Video', title: 'Background video' },
  { key: 'background', label: 'BG', title: 'Custom background image' },
  { key: 'highway', label: 'Highway', title: 'Custom highway texture' },
  { key: 'albumArt', label: 'Art', title: 'Album artwork' }
]

const PROBLEM: Record<LibProblem, { badge: string; sub: string }> = {
  chart: { badge: 'Missing chart', sub: 'Audio only, no notes.mid or notes.chart' },
  audio: { badge: 'Missing audio', sub: 'Chart only, no audio files' },
  both: { badge: 'Missing chart & audio', sub: 'Only song.ini is left' }
}

const parentOf = (rel: string): string => rel.split('/').slice(0, -1).join('/')

/** Kterou kopii si nechat: víc „navíc" (stems/video/obal…), pak kratší cesta. */
interface ScoreCtx {
  broken: Map<string, LibProblem>
  infos: Record<string, LibSongInfo>
  /** Upřednostněné nástroje (jen u různých verzí). */
  prefer: string[]
}

/**
 * Skóre „kterou kopii si nechat" (vyšší = lepší):
 *  1. rozbitá kopie nikdy nevyhraje,
 *  2. jen u RŮZNÝCH verzí: má všechny upřednostněné nástroje → kolik z nich →
 *     kolik nástrojů je celkem nacharovaných (u identických je to stejné),
 *  3. víc „navíc" (stems, video, pozadí, highway, obal),
 *  4. kratší cesta (originál před „ - kopie" / „(2)", méně zanořená složka).
 */
function keepScore(s: DupSong, reason: DupGroup['reason'], ctx: ScoreCtx): number {
  let score = ctx.broken.has(s.rel) ? -1e12 : 0
  if (reason === 'same-song') {
    const d = ctx.infos[s.rel]?.difficulties
    const charted = INSTRUMENTS.filter((i) => d && d[i.id] !== undefined).map((i) => i.id as string)
    const hit = ctx.prefer.filter((p) => charted.includes(p)).length
    if (ctx.prefer.length && hit === ctx.prefer.length) score += 1e9
    score += hit * 1e8 + charted.length * 1e7
  }
  const extras = EXTRA_META.reduce((a, m) => a + (s.extras[m.key] ? 1 : 0), 0)
  return score + extras * 1000 - s.rel.length
}
const bestOf = (g: DupGroup, ctx: ScoreCtx): DupSong =>
  [...g.songs].sort((a, b) => keepScore(b, g.reason, ctx) - keepScore(a, g.reason, ctx))[0]

type Tab = 'dups' | 'broken'
type Kind = 'all' | 'identical' | 'same-song'

// Výsledek posledního skenu přežije přepnutí obrazovek (sken velké knihovny trvá).
let lastScan: { scope: string[]; groups: DupGroup[]; broken: LibEntry[] } | null = null

/** Oddělovač cest ve `selKey` — NUL se v cestě souboru vyskytnout nemůže. */
const SEL_SEP = '\u0000'

/** Jedna skupina duplicit. Memo: klik na kartu překreslí jen svou skupinu, ne všech N. */
const DupGroupCard = memo(function DupGroupCard({
  g,
  keepRel,
  selKey,
  brokenMap,
  infos,
  thumbs,
  preferOn,
  toggle,
  onReveal
}: {
  g: DupGroup
  keepRel: string
  /** Vybrané kopie této skupiny jako řetězec — mění se jen při změně výběru ve skupině. */
  selKey: string
  brokenMap: Map<string, LibProblem>
  infos: Record<string, LibSongInfo>
  thumbs: Record<string, string | null>
  preferOn: boolean
  toggle: (rel: string, shift: boolean) => void
  onReveal: (rel: string) => void
}): JSX.Element {
  const sel = new Set(selKey ? selKey.split(SEL_SEP) : [])
  const head = g.songs[0]
  const all = g.songs.every((s) => sel.has(s.rel))
  const prefer = preferOn ? [1] : []
  return (
    <article className="dpv__group">
      <header className="dpv__ghead">
        <div className="dpv__gtitle">
          <RichText text={head.title} />
          {head.artist ? (
            <span className="dpv__gartist">
              <RichText text={head.artist} />
            </span>
          ) : null}
        </div>
        <span className={`dpv__kind dpv__kind--${g.reason}`}>
          {g.reason === 'identical' ? 'Identical' : 'Different versions'}
        </span>
        <span className="ltool__dim">{g.songs.length} copies</span>
        {g.songs.some((s) => brokenMap.has(s.rel)) ? (
          <span className="dpv__gbroken">
            <Icon name="alert" size={12} /> Broken copy inside
          </span>
        ) : null}
        {all ? (
          <span className="dpv__wipe">
            <Icon name="alert" size={12} /> Every copy is selected
          </span>
        ) : null}
      </header>
      <div className="dpv__copies">
        {g.songs.map((s) => {
          const inf = infos[s.rel]
          const on = sel.has(s.rel)
          const extras = EXTRA_META.filter((m) => s.extras[m.key])
          return (
            <div
              key={s.rel}
              className={`dpv__copy ${on ? 'dpv__copy--on' : ''} ${brokenMap.has(s.rel) ? 'dpv__copy--broken' : ''}`}
              onClick={(e) => toggle(s.rel, e.shiftKey)}
              onMouseDown={noShiftSelect}
              title={on ? 'Selected for removal. Click to keep.' : 'Click to select for removal'}
            >
              <div className="dpv__copytop">
                <span onClick={(e) => e.stopPropagation()}>
                  <SongArt rel={s.rel} thumb={thumbs[s.rel]} previewKey={`dpv:${s.rel}`} size="lg" />
                </span>
                <div className="dpv__copyinfo">
                  <div className="dpv__copyname" title={s.name}>
                    <RichText text={s.name} />
                  </div>
                  <div className="dpv__where" title={parentOf(s.rel) ? `Songs/${parentOf(s.rel)}` : 'Songs'}>
                    <Icon name="folder" size={11} /> {parentOf(s.rel) || 'Songs'}
                  </div>
                  <div className="dpv__copymeta">
                    {s.charter ? (
                      <span>
                        <Icon name="charter" size={11} /> <RichText text={s.charter} />
                      </span>
                    ) : null}
                    {inf?.lengthSeconds ? <span>{formatLength(inf.lengthSeconds)}</span> : null}
                    {inf?.year ? <span>{inf.year}</span> : null}
                  </div>
                </div>
              </div>
              {brokenMap.has(s.rel) ? (
                <div className="dpv__brokentag" title="Clone Hero won't load this copy">
                  <Icon name="alert" size={12} /> Broken · {PROBLEM[brokenMap.get(s.rel) as LibProblem].badge}
                </div>
              ) : null}
              <div className="dpv__copymid">
                {inf ? <PlInstruments difficulties={inf.difficulties} /> : <span className="ltool__dim">…</span>}
                <span className="dpv__extras">
                  {extras.map((m) => (
                    <span key={m.key} className="dpv__extra" title={m.title}>
                      {m.label}
                    </span>
                  ))}
                </span>
              </div>
              <div className="dpv__copyfoot">
                <span
                  className={`dpv__state ${on ? 'dpv__state--rm' : s.rel === keepRel ? 'dpv__state--best' : ''}`}
                  title={
                    s.rel === keepRel && !on
                      ? g.reason === 'same-song'
                        ? prefer.length
                          ? 'Best match for your preferred instruments, then the most instruments charted and extras'
                          : 'Has the most instruments charted, then the most extras (stems, video, art…)'
                        : 'Identical copies: the one with the most extras, then the shortest path'
                      : undefined
                  }
                >
                  {on ? (
                    <>
                      <Icon name="trash" size={12} /> Remove
                    </>
                  ) : s.rel === keepRel ? (
                    <>
                      <Icon name="check" size={12} /> {g.reason === 'same-song' ? 'Best match' : 'Best copy'}
                    </>
                  ) : (
                    'Keep'
                  )}
                </span>
                <button
                  type="button"
                  className="ltool__iconbtn"
                  title="Show in Songs"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReveal(s.rel)
                  }}
                >
                  <Icon name="folder" size={14} />
                </button>
                <button
                  type="button"
                  className="ltool__iconbtn"
                  title="Show in Explorer"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.api.libReveal(s.rel)
                  }}
                >
                  <Icon name="external" size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </article>
  )
})

export function DuplicatesView({
  onChanged,
  onReveal
}: {
  onChanged: () => void
  onReveal: (rel: string) => void
}): JSX.Element {
  const startFix = useStore((s) => s.startFix)
  const openBulkFix = useStore((s) => s.openBulkFix)
  const bulkRun = useStore((s) => s.bulkRun)
  const del = deleteWords(useStore((s) => s.config?.deleteMode), IS_MAC)
  const [folders, setFolders] = useState<string[]>([])
  const [scope, setScope] = useState<Set<string>>(new Set(lastScan?.scope ?? []))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [groups, setGroups] = useState<DupGroup[] | null>(lastScan?.groups ?? null)
  const [broken, setBroken] = useState<LibEntry[] | null>(lastScan?.broken ?? null)
  const [scanning, setScanning] = useState(false)
  const [tab, setTab] = useState<Tab>('dups')
  const [kind, setKind] = useState<Kind>('all')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmTrash, setConfirmTrash] = useState(false)

  useEffect(() => {
    void window.api
      .listSongFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const scan = async (withScope: Set<string> = scope): Promise<void> => {
    setScanning(true)
    setError(null)
    setChecked(new Set())
    setConfirmTrash(false)
    const sc = [...withScope]
    try {
      const [g, b] = await Promise.all([
        window.api.libFindDuplicates(sc.length ? sc : undefined),
        sc.length
          ? Promise.all(sc.map((f) => window.api.libFindBroken(f).then((l) => l.map((e) => ({ ...e, name: `${f}/${e.name}` })))))
              .then((ls) => ls.flat())
          : window.api.libFindBroken('')
      ])
      setGroups(g)
      setBroken(b)
      lastScan = { scope: sc, groups: g, broken: b }
    } catch (e) {
      setError(userMsg(e))
    } finally {
      setScanning(false)
    }
  }

  // Po hromadné opravě rozbitých písní seznam obnovit.
  const fixed = bulkRun ? bulkRun.ok + bulkRun.failed : 0
  useEffect(() => {
    if (fixed > 0 && broken) void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed])

  // Kopie, které jsou zároveň rozbité (chybí chart / audio) — vyznačit na kartě.
  const brokenMap = useMemo(() => new Map((broken ?? []).map((e) => [e.name, e.problem ?? 'chart'] as const)), [broken])
  const prefer = useStore((s) => s.config?.dupPreferInstruments) ?? []
  const togglePrefer = (id: string): void => {
    const next = prefer.includes(id) ? prefer.filter((p) => p !== id) : [...prefer, id]
    void useStore.getState().saveConfig({ dupPreferInstruments: next })
  }
  const shownGroups = (groups ?? []).filter((g) => kind === 'all' || g.reason === kind)
  const allRels = useMemo(() => (groups ?? []).flatMap((g) => g.songs.map((s) => s.rel)), [groups])
  // Akce se týkají jen skupin, které filtr právě ukazuje — nic skrytého se nesmaže.
  const shownRels = useMemo(
    () => new Set((groups ?? []).filter((g) => kind === 'all' || g.reason === kind).flatMap((g) => g.songs.map((s) => s.rel))),
    [groups, kind]
  )
  const { thumbs, infos } = useSongExtras(allRels)
  const scoreCtx: ScoreCtx = { broken: brokenMap, infos, prefer }
  const identicalCount = (groups ?? []).filter((g) => g.reason === 'identical').length
  const extraCopies = (groups ?? []).reduce((a, g) => a + g.songs.length - 1, 0)


  // Hromadný výběr: v každé zobrazené skupině vše kromě nejlepší kopie.
  const autoSelect = (): void => {
    const next = new Set<string>()
    for (const g of shownGroups) {
      const keep = bestOf(g, scoreCtx)
      for (const s of g.songs) if (s.rel !== keep.rel) next.add(s.rel)
    }
    setChecked(next)
  }

  const brokenRel = (e: LibEntry): string => e.name
  const brokenRels = (broken ?? []).map(brokenRel)
  // Klik přepne kopii, Shift+klik celý rozsah (v pořadí, jak jsou karty vidět).
  const dupOrder = useMemo(
    () => (groups ?? []).filter((g) => kind === 'all' || g.reason === kind).flatMap((g) => g.songs.map((s) => s.rel)),
    [groups, kind]
  )
  const rangeDup = useRangeToggle(dupOrder, (r) => checked.has(r), setInSet(setChecked))
  const rangeBroken = useRangeToggle(brokenRels, (r) => checked.has(r), setInSet(setChecked))
  // Stabilní funkce pro memoizované karty skupin (jinak by se překreslily všechny).
  const rangeDupRef = useRef(rangeDup)
  rangeDupRef.current = rangeDup
  const toggle = useCallback((rel: string, shift: boolean) => rangeDupRef.current(rel, shift), [])
  useChecklistKeys(
    // Na duplicitách Ctrl+A = „All extra copies" (nejlepší kopie zůstanou), ne
    // úplně všechno — jinak by smazání odstranilo každou kopii písně.
    () => (tab === 'dups' ? autoSelect() : setChecked(new Set(brokenRels))),
    () => {
      if (!checked.size) return false
      setChecked(new Set())
      setConfirmTrash(false)
      return true
    }
  )
  const selectedHere = tab === 'dups' ? [...checked].filter((r) => shownRels.has(r)) : [...checked].filter((r) => brokenRels.includes(r))
  // Skupina, ze které je vybrané úplně všechno — chceme varovat.
  const wipedGroups = shownGroups.filter((g) => g.songs.every((s) => checked.has(s.rel))).length

  const afterChange = async (rels: string[], msg: string, failed: string | null): Promise<void> => {
    forgetSongExtras(rels)
    onChanged()
    await scan()
    if (failed) setError(failed)
    else setNotice(msg)
  }

  const trashSelected = async (): Promise<void> => {
    const rels = selectedHere
    if (!rels.length || busy) return
    setBusy(true)
    setConfirmTrash(false)
    let failed: string | null = null
    for (const rel of rels) {
      try {
        await window.api.libTrash(rel)
      } catch (e) {
        failed = userMsg(e)
      }
    }
    const what = `${rels.length} ${rels.length === 1 ? 'folder' : 'folders'}`
    await afterChange(rels, del.permanent ? `Deleted ${what} permanently` : `Moved ${what} to the ${del.bin}`, failed)
    setBusy(false)
  }

  // Přesun do zvolené složky místo koše (karanténa; funguje i tam, kde koš ne — Wine).
  const moveSelected = async (): Promise<void> => {
    const rels = selectedHere
    if (!rels.length || busy) return
    const dir = await window.api.chooseDirectory(useStore.getState().config?.dupMoveDir || undefined)
    if (!dir) return
    setBusy(true)
    let failed: string | null = null
    try {
      await window.api.libMoveOut(rels, dir)
      void useStore.getState().saveConfig({ dupMoveDir: dir })
    } catch (e) {
      failed = userMsg(e)
    }
    await afterChange(rels, `Moved ${rels.length} ${rels.length === 1 ? 'folder' : 'folders'} to ${dir}`, failed)
    setBusy(false)
  }

  // Zpět na úvodní volbu: výsledky, výběr i načtené obaly zahodit, ať nic
  // zbytečně nevisí v paměti ani se nevykresluje.
  const closeResults = (): void => {
    forgetSongExtras((groups ?? []).flatMap((g) => g.songs.map((x) => x.rel)))
    lastScan = null
    setGroups(null)
    setBroken(null)
    setChecked(new Set())
    setConfirmTrash(false)
    setPickerOpen(false)
    setTab('dups')
  }

  const scopeLabel = scope.size === 0 ? 'Whole library' : `${scope.size} of ${folders.length} folders`
  const started = groups !== null

  const picker =
    pickerOpen && folders.length > 0 ? (
      <div className="dpv__picker">
        <div className="dpv__pickerhead">
          <span>Folders to search</span>
          <button className="lv__link" type="button" onClick={() => setScope(new Set())}>
            Clear
          </button>
        </div>
        <div className="dpv__pickerlist">
          {folders.map((f) => (
            <label key={f} className="dpv__pickitem">
              <span className="chk">
                <input
                  type="checkbox"
                  checked={scope.has(f)}
                  onChange={() => {
                    const n = new Set(scope)
                    n.has(f) ? n.delete(f) : n.add(f)
                    setScope(n)
                  }}
                />
                <span className="chk__box">
                  <Icon name="check" size={12} />
                </span>
              </span>
              <Icon name="folder" size={13} />
              <span className="dpv__pickname">{f}</span>
            </label>
          ))}
        </div>
        <div className="dpv__pickerfoot">
          <span className="ltool__dim">{scope.size ? `${scope.size} picked` : 'None picked = whole library'}</span>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setPickerOpen(false)
              void scan()
            }}
          >
            <Icon name="search" size={13} /> Scan
          </button>
        </div>
      </div>
    ) : null

  return (
    <div className="ltool" style={{ '--sc': '#4a90e2' } as React.CSSProperties}>
      <ToolHead
        icon="copy"
        color="#4a90e2"
        title="Duplicates & broken songs"
        sub="Find charts you have more than once and song folders Clone Hero can't load."
      >
        {notice ? (
          <span className="stv__notice">
            <Icon name="check" size={12} /> {notice}
          </span>
        ) : null}
      </ToolHead>

      {!started ? (
        <div className="ltool__body">
          <div className="dpv__start">
            <p className="dpv__lead">What should be scanned? A big library takes a moment.</p>
            <div className="dpv__startopts">
              <button
                className="dpv__startopt"
                disabled={scanning}
                onClick={() => {
                  setScope(new Set())
                  setPickerOpen(false)
                  void scan(new Set())
                }}
              >
                <span className="dpv__starticon">
                  <Icon name="folder" size={20} />
                </span>
                <span>
                  <span className="dpv__startt">{scanning ? 'Scanning…' : 'Scan everything'}</span>
                  <span className="dpv__starts">Every folder in your Songs library.</span>
                </span>
              </button>
              <button className="dpv__startopt" disabled={folders.length === 0 || scanning} onClick={() => setPickerOpen((o) => !o)}>
                <span className="dpv__starticon">
                  <Icon name="filter" size={20} />
                </span>
                <span>
                  <span className="dpv__startt">Pick folders</span>
                  <span className="dpv__starts">
                    {folders.length ? `Choose from ${folders.length} folders. Faster on a big library.` : 'Your library has no subfolders.'}
                  </span>
                </span>
              </button>
            </div>
            {picker}
          </div>
        </div>
      ) : (
        <>
          <div className="dpv__bar">
            <div className="seg dpv__tabs" role="tablist">
              <button type="button" role="tab" className={tab === 'dups' ? 'on' : ''} onClick={() => { setTab('dups'); setChecked(new Set()); setConfirmTrash(false) }}>
                <Icon name="copy" size={13} /> Duplicates <span className="dpv__count">{groups?.length ?? 0}</span>
              </button>
              <button type="button" role="tab" className={tab === 'broken' ? 'on' : ''} onClick={() => { setTab('broken'); setChecked(new Set()); setConfirmTrash(false) }}>
                <Icon name="alert" size={13} /> Broken songs <span className="dpv__count dpv__count--warn">{broken?.length ?? 0}</span>
              </button>
            </div>
            <div className="lib__spacer" />
            <div className="dpv__scopewrap">
              <button type="button" className="dpv__scope" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
                <Icon name="folder" size={13} /> {scopeLabel} <Icon name="caret" size={11} />
              </button>
              {picker}
            </div>
            <button type="button" className="btn-secondary" disabled={scanning} onClick={() => void scan()}>
              <Icon name="refresh" size={13} /> {scanning ? 'Scanning…' : 'Rescan'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={scanning}
              title="Close the results and go back to choosing what to scan. Frees the memory the results use."
              onClick={closeResults}
            >
              <Icon name="close" size={13} /> Close results
            </button>
          </div>

          <div className="ltool__body">
            {/* Seznam duplicit zůstává vykreslený i na záložce Broken songs (jen skrytý),
                jinak by se při návratu stovky skupin sestavovaly znovu a přepnutí by vázlo. */}
            <div className="dpv__pane" hidden={tab !== 'dups'}>
                {groups && groups.length > 0 ? (
                  <div className="dpv__summary">
                    <div className="dpv__stat">
                      <strong>{groups.length}</strong>
                      <span>songs with copies</span>
                    </div>
                    <div className="dpv__stat">
                      <strong>{extraCopies}</strong>
                      <span>extra copies</span>
                    </div>
                    <div className="dpv__stat">
                      <strong>{identicalCount}</strong>
                      <span>byte-for-byte identical</span>
                    </div>
                    <div className="dpv__quick">
                      <span className="ltool__label">Quick select</span>
                      <div className="dpv__quickbtns">
                        <button
                          className="btn-secondary"
                          title={
                            kind === 'identical'
                              ? 'In every identical group, select all copies except the best one'
                              : kind === 'same-song'
                                ? 'In every different-versions group, select all copies except the best one'
                                : 'In every group, select all copies except the best one'
                          }
                          onClick={autoSelect}
                        >
                          All extra copies
                        </button>
                        {checked.size ? (
                          <button className="lv__link" onClick={() => setChecked(new Set())}>
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="dpv__prefer">
                      <span className="ltool__label">Different versions: prefer</span>
                      <div className="dpv__preferchips">
                        {INSTRUMENTS.map((i) => (
                          <button
                            key={i.id}
                            type="button"
                            className={`dpv__pchip ${prefer.includes(i.id) ? 'dpv__pchip--on' : ''}`}
                            style={{ '--ic': i.color } as React.CSSProperties}
                            aria-pressed={prefer.includes(i.id)}
                            title={`Prefer versions that have ${i.label.toLowerCase()} charted`}
                            onClick={() => togglePrefer(i.id)}
                          >
                            <Icon name={i.icon} size={14} />
                            {i.label}
                          </button>
                        ))}
                      </div>
                      <span className="dpv__preferhint">
                        {prefer.length
                          ? 'Versions with these instruments charted win. Identical copies aren’t affected.'
                          : 'No preference: the version with the most instruments charted wins.'}
                      </span>
                    </div>
                  </div>
                ) : null}

                {groups && groups.length > 0 ? (
                  <div className="seg dpv__kinds">
                    {(
                      [
                        ['all', 'All'],
                        ['identical', 'Identical'],
                        ['same-song', 'Different versions']
                      ] as [Kind, string][]
                    ).map(([k, l]) => (
                      <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                        {l}
                      </button>
                    ))}
                  </div>
                ) : null}

                {scanning && !groups?.length ? (
                  <p className="ltool__muted">Scanning…</p>
                ) : shownGroups.length === 0 ? (
                  <div className="ltool__empty">
                    <Icon name="check" size={30} />
                    <p>{scope.size ? 'No duplicates in the folders you picked.' : 'No duplicates found. Your library is tidy.'}</p>
                  </div>
                ) : (
                  shownGroups.map((g, gi) => (
                    <DupGroupCard
                      key={`${g.reason}-${gi}-${g.songs[0].rel}`}
                      g={g}
                      keepRel={bestOf(g, scoreCtx).rel}
                      selKey={g.songs.filter((x) => checked.has(x.rel)).map((x) => x.rel).join(SEL_SEP)}
                      brokenMap={brokenMap}
                      infos={infos}
                      thumbs={thumbs}
                      preferOn={prefer.length > 0}
                      toggle={toggle}
                      onReveal={onReveal}
                    />
                  ))
                )}
            </div>
            {tab === 'broken' ? (
              <>
                {broken && broken.length > 0 ? (
                  <div className="dpv__brokenhead">
                    <p className="ltool__dim">
                      These folders are missing their chart, their audio or both, so Clone Hero won't load them. Fix them with a fresh download, or remove them.
                    </p>
                    <button
                      className="btn-primary dpv__fixall"
                      disabled={!!bulkRun && fixed < bulkRun.total}
                      onClick={() => {
                        const pick = selectedHere.length ? (broken ?? []).filter((e) => checked.has(e.name)) : broken ?? []
                        openBulkFix(pick.map((e) => ({ rel: e.name, name: e.name.split('/').pop() ?? e.name })))
                      }}
                    >
                      <Icon name="download" size={13} /> {selectedHere.length ? `Fix ${selectedHere.length} selected` : `Fix all ${broken.length}`}
                    </button>
                  </div>
                ) : null}
                {bulkRun ? (
                  <div className="dpv__bulkrun">
                    {fixed < bulkRun.total ? <i className="catact__spin" /> : <Icon name="check" size={13} />}
                    {fixed < bulkRun.total ? `Fixing broken songs ${fixed}/${bulkRun.total}` : `Fixed ${bulkRun.ok} of ${bulkRun.total}`}
                  </div>
                ) : null}
                {!broken || broken.length === 0 ? (
                  <div className="ltool__empty">
                    <Icon name="check" size={30} />
                    <p>No broken songs found.</p>
                  </div>
                ) : (
                  <div className="dpv__broken">
                    {broken.map((e) => {
                      const rel = brokenRel(e)
                      const on = checked.has(rel)
                      const label = rel.split('/').pop() ?? rel
                      const p = PROBLEM[e.problem ?? 'chart']
                      return (
                        <div
                          key={rel}
                          className={`dpv__brow ${on ? 'dpv__brow--on' : ''}`}
                          onClick={(ev) => isRowClick(ev) && rangeBroken(rel, ev.shiftKey)}
                          onMouseDown={noShiftSelect}
                        >
                          <label
                            className="chk"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              if (ev.shiftKey) {
                                ev.preventDefault()
                                rangeBroken(rel, true)
                              }
                            }}
                          >
                            <input type="checkbox" checked={on} onChange={() => rangeBroken(rel, false)} />
                            <span className="chk__box">
                              <Icon name="check" size={12} />
                            </span>
                          </label>
                          <span className="dpv__bicon">
                            <Icon name="alert" size={18} />
                          </span>
                          <span className="dpv__btext">
                            <span className="dpv__bname" title={rel}>
                              {stripTags(label)}
                            </span>
                            <span className="dpv__bsub">
                              {p.sub}
                              {parentOf(rel) ? <span className="ltool__dim"> · in {parentOf(rel)}</span> : null}
                            </span>
                          </span>
                          <span className="lvbroken-badge">
                            <Icon name="alert" size={12} /> {p.badge}
                          </span>
                          <button
                            type="button"
                            className="lvfix"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              const q = songFromFolderName(label)
                              startFix(rel, label, q.artist, q.title)
                            }}
                          >
                            Fix it
                          </button>
                          <button
                            type="button"
                            className="ltool__iconbtn"
                            title="Show in Songs"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              onReveal(rel)
                            }}
                          >
                            <Icon name="folder" size={14} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : null}
            {error ? <div className="lib__error">⚠ {error}</div> : null}
          </div>

          {selectedHere.length > 0 ? (
            <div className="ltool__bar">
              <span>
                <strong>{selectedHere.length}</strong> selected
                {tab === 'dups' && wipedGroups ? (
                  <span className="ltool__warn">
                    {' '}
                    · every copy of {wipedGroups} {wipedGroups === 1 ? 'song' : 'songs'} is selected
                  </span>
                ) : null}
              </span>
              <div className="lib__spacer" />
              {confirmTrash ? (
                <>
                  <span className={del.permanent ? 'ltool__warn' : 'ltool__dim'}>
                    {del.permanent
                      ? `Delete ${selectedHere.length} permanently? This can’t be undone.`
                      : `Move ${selectedHere.length} to the ${del.bin}?`}
                  </span>
                  <button className="btn-secondary" onClick={() => setConfirmTrash(false)}>
                    Cancel
                  </button>
                  <button className="btn-primary ltool__dangerbtn" disabled={busy} onClick={() => void trashSelected()}>
                    {busy ? 'Working…' : del.permanent ? 'Yes, delete' : 'Yes, remove'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-secondary" onClick={() => setChecked(new Set())}>
                    Clear
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    title={`Move them to a folder of your choice instead of deleting. Works where the ${del.bin} does not (e.g. Wine on Linux).`}
                    onClick={() => void moveSelected()}
                  >
                    Move to folder…
                  </button>
                  <button className="btn-primary ltool__dangerbtn" disabled={busy} onClick={() => setConfirmTrash(true)}>
                    <Icon name="trash" size={13} /> {del.verb}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
