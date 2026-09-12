import { useEffect, useState } from 'react'
import githubLogo from '../assets/github.svg'
import redditLogo from '../assets/reddit_logo.png'
import xLogo from '../assets/X_logo.jpg'
import zipeekLogo from '../assets/zipeek_logo.webp'
import { useStore } from '../store'
import { IS_LINUX, IS_MAC } from '../platform'
import { Icon } from './Icon'

const REPO_URL = 'https://github.com/xlzipx/clone-hero-chart-manager'
const STUDIO_URL = 'https://github.com/xlzipx/clone-hero-chart-studio'
const X_URL = 'https://x.com/xlZiPx'
const REDDIT_URL = 'https://www.reddit.com/user/xlZiPx/'

// GitHub logo přes CSS masku (ne <img>): jednobarevné SVG by přes <img> NEzdědilo
// currentColor a vyšlo by natvrdo skoro černé = na tmavém neviditelné. Maskou barvu
// řídí CSS (`background: currentColor`). URL v uvozovkách je NUTNOST, ne kosmetika:
// github.svg je pod 4 kB, takže ho Vite v produkci inlinuje jako data URI — a ten
// obsahuje apostrofy (viewBox='0 0 16 16'). Neuvozovkovaný url() je pak podle CSS
// specifikace nevalidní → maska se nenačte a zbyde prázdný čtverec. V devu to
// nevyjde najevo (tam se servíruje jako cesta k souboru).
const GH_MASK = {
  WebkitMaskImage: `url("${githubLogo}")`,
  maskImage: `url("${githubLogo}")`
}

// Hodnoty projektu jedním pohledem. Krátká slova schválně — je to signál, ne text.
const VALUES = ['Free', 'Open source', 'No ads', 'No accounts']

// Co appka umí. Odrážky místo odstavce: tohle si nikdo nečte, tohle si scanuje.
const FEATURES = [
  'Search RhythmVerse and Chorus Encore together, or one at a time.',
  'Preview a song before you download it, so you know what you are getting.',
  'Rock Band charts are converted to Clone Hero for you.',
  'Paste a Spotify playlist and get a chart for every song that has one.',
  'Keep the library tidy: duplicates, playlists, metadata and artwork.'
]

/** About okno — otevírá se klikem na logo v titlebaru. */
export function AboutModal(): JSX.Element | null {
  const show = useStore((s) => s.showAbout)
  const close = useStore((s) => s.setShowAbout)
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (show) void window.api.appVersion().then(setVersion)
  }, [show])

  if (!show) return null

  const open = (url: string) => (): void => window.api.openExternal(url)

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div className="modal modal--about" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>
            <Icon name="info" size={18} /> About
          </h2>
          <button className="modal__close" onClick={() => close(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal__body about__body">
          <div className="about__hero">
            {/* Značka PŘESNĚ jako v titlebaru: pruhy vlevo od textu, `brand-mark`
                + `brand-text` = tytéž třídy. About si NESMÍ kreslit vlastní
                variantu (font, řazení, velikosti) — hned by se to rozešlo. */}
            <div className="about__logo">
              <span className="brand-mark about__mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="brand-text about__name">
                <span className="brand-w1">Chart</span> <span className="brand-w2">Manager</span>
                <span className="brand-dot">.</span>
              </span>
            </div>
            <div className="about__meta">
              {version ? <span className="about__ver">v{version}</span> : null}
              <span>MIT licence</span>
              <span>{IS_MAC ? 'macOS' : IS_LINUX ? 'Linux' : 'Windows'}</span>
            </div>
          </div>

          <p className="about__lead">
            One place to find, preview, download and organise charts for Clone Hero and YARG.
            Search two catalogues at once, drop in a Spotify playlist, and keep your Songs folder
            tidy.
          </p>

          <div className="about__values">
            {VALUES.map((v) => (
              <span key={v} className="about__value">
                <Icon name="check" size={10} /> {v}
              </span>
            ))}
          </div>

          <ul className="about__feats">
            {FEATURES.map((f) => (
              <li key={f}>
                <Icon name="check" size={11} className="about__featicon" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {/* Dva zdrojáky: tahle appka + sesterský editor Chart Studio. Každé
              tlačítko nese GitHub značku, ať je jasné, že vede na repo. */}
          <div className="about__ghrow">
            <button
              className="about__gh"
              onClick={open(STUDIO_URL)}
              title="View Chart Studio on GitHub"
            >
              <span className="about__ghicon" style={GH_MASK} aria-hidden="true" />
              Chart Studio
              <Icon name="external" size={13} className="about__ghgo" />
            </button>
            <span className="about__ghdiv" aria-hidden="true" />
            <button
              className="about__gh"
              onClick={open(REPO_URL)}
              title="View Chart Manager on GitHub"
            >
              <span className="about__ghicon" style={GH_MASK} aria-hidden="true" />
              Chart Manager
              <Icon name="external" size={13} className="about__ghgo" />
            </button>
          </div>
          {/* Krátké představení Chart Studia pod repo tlačítky. Popisné, ne
              klikací — odkaz obstarává tlačítko „Chart Studio" nad tím. */}
          <div className="about__studio">
            <div className="about__studiohead">
              <span className="about__studiotitle">Chart Studio</span>
              <span className="about__studiotag">Chart editor</span>
            </div>
            <p className="about__studiodesc">
              Build and edit your own charts with a built‑in engine: drums and 5‑fret
              guitar/bass, in 2D, 3D and split views. Pull audio from a link, sync
              lyrics, and playtest without ever leaving the editor.
            </p>
          </div>

          {/* Kontaktní karta — vizitka na jednom řádku (avatar+jméno vlevo,
              odkazy vpravo). Krátký lead nahoře říká, proč jsou tam odkazy. */}
          <div className="about__contact">
            <p className="about__contactlead">
              Got a question or an issue? Feel free to reach out.
            </p>
            <div className="about__contactrow">
              <div className="about__whohead">
                <img className="about__avatar" src={zipeekLogo} alt="" />
                <span className="about__whotexts">
                  <span className="about__whoname">ZIPEEK</span>
                  <span className="about__whorole">Creator of Chart Manager</span>
                </span>
              </div>
              <div className="about__socials">
                <button className="about__social" onClick={open(X_URL)}>
                  {/* JPG (rastr), takže <img>. Bílé pozadí kolem loga je součást
                      souboru — obarvit z CSS nejde, jen zaoblím rohy. */}
                  <img className="about__socicon" src={xLogo} alt="" />
                  <span>X</span>
                  <span className="about__sochandle">@xlZiPx</span>
                </button>
                <button className="about__social" onClick={open(REDDIT_URL)}>
                  <img className="about__socicon" src={redditLogo} alt="" />
                  <span>Reddit</span>
                  <span className="about__sochandle">u/xlZiPx</span>
                </button>
              </div>
            </div>
          </div>

          <p className="about__credits">
            Charts come from{' '}
            <button className="about__link" onClick={open('https://rhythmverse.co')}>
              RhythmVerse
            </button>{' '}
            and{' '}
            <button className="about__link" onClick={open('https://www.enchor.us')}>
              Chorus Encore
            </button>
            . Not affiliated with either, nor with Clone Hero or Harmonix.
          </p>
        </div>
      </div>
    </div>
  )
}
