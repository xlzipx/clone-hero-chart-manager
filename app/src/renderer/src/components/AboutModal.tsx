import { useEffect, useState } from 'react'
import githubLogo from '../assets/github.svg'
import redditLogo from '../assets/reddit_logo.png'
import xLogo from '../assets/X_logo.jpg'
import zipeekLogo from '../assets/zipeek_logo.webp'
import { useStore } from '../store'
import { Icon } from './Icon'

const REPO_URL = 'https://github.com/xlzipx/clone-hero-chart-manager'
const X_URL = 'https://x.com/xlZiPx'
const REDDIT_URL = 'https://www.reddit.com/user/xlZiPx/'

// Hodnoty projektu jedním pohledem. Krátká slova schválně — je to signál, ne text.
const VALUES = ['Free', 'Open source', 'No ads', 'No accounts']

// Co appka umí. Odrážky místo odstavce: tohle si nikdo nečte, tohle si scanuje.
const FEATURES = [
  'Search RhythmVerse and Chorus Encore together, or one at a time.',
  'Preview a song before you download it, so you know what you are getting.',
  'Rock Band charts are converted to Clone Hero for you.',
  'Paste a Spotify playlist and get a chart for every song in it.',
  'Keep the library tidy: duplicates, playlists, metadata and artwork.'
]

/** About okno — otevírá se klikem na logo v titlebaru. */
export function AboutModal(): JSX.Element | null {
  const show = useStore((s) => s.showAbout)
  const close = useStore((s) => s.setShowAbout)
  const [version, setVersion] = useState('')
  // Bio je slohovka → zabalené. Kdo chce, rozklikne; ostatním nepřekáží.
  const [bioOpen, setBioOpen] = useState(false)

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
              <span>Windows</span>
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

          <button className="about__gh" onClick={open(REPO_URL)}>
            {/* Maska, ne <img>: GitHub logo je jednobarevné a `<img>` NEDĚDÍ
                currentColor (SVG se v něm renderuje ve vlastním kontextu) →
                vyšlo by černé na tmavém. Stejný postup jako u Spotify loga. */}
            <span
              className="about__ghicon"
              // URL v uvozovkách je NUTNOST, ne kosmetika: github.svg je pod 4 kB,
              // takže ho Vite v produkci inlinuje jako data URI — a ten obsahuje
              // APOSTROFY (viewBox='0 0 16 16'). Neuvozovkovaný url() je podle CSS
              // specifikace mít nesmí → maska se nenačte a zbyde bílý čtverec.
              // V devu to nevyjde najevo, tam se servíruje jako cesta k souboru.
              style={{
                WebkitMaskImage: `url("${githubLogo}")`,
                maskImage: `url("${githubLogo}")`
              }}
              aria-hidden="true"
            />
            View the source on GitHub
            <Icon name="external" size={13} className="about__ghgo" />
          </button>

          {/* Bio pod rozkliknutím — stejná roleta (0fr↔1fr) jako sekce v Nastavení. */}
          <div className="field--disc about__disc">
            <button
              type="button"
              className="disc__head"
              aria-expanded={bioOpen}
              onClick={() => setBioOpen((o) => !o)}
            >
              <span className="about__whohead">
                <img className="about__avatar" src={zipeekLogo} alt="" />
                <span className="disc__titles">
                  <span className="disc__title">ZIPEEK</span>
                  <span className="disc__sub">Creator of Chart Manager</span>
                </span>
              </span>
              <Icon name="caret" size={12} className="disc__caret" />
            </button>
            <div className={`disc ${bioOpen ? 'disc--open' : ''}`}>
              <div className="disc__inner">
                <div className="about__bio">
                  <p>
                    Hi, my name is Jan (aka ZIPEEK). I'm a PC enthusiast with a passion for graphic
                    design, music, sports and science. I work as a sales assistant in a small family
                    business, and I spend every moment of free time on my hobbies, from gaming to
                    music to the latest tech.
                  </p>
                  <p>
                    This app was built with Claude Code. It opened a door that would have been
                    unthinkable for me before, and the deeper I get into this, the more respect I
                    have for developers and the craft behind their work.
                  </p>
                  <p className="about__bioend">
                    I share my creations with everyone, and everything is free to download.
                  </p>
                  {/* Kontaktní odkazy pod bio — X i Reddit jako alternativní reach. */}
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
