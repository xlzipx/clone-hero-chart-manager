import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStore } from '../store'
import { TIPS } from '../tips'

/** Rotace tipu (ms), fade při výměně obsahu (ms), délka wipe animace (ms). */
const ROTATE_MS = 9000
const FADE_MS = 180
const WIPE_MS = 520

/**
 * Rotující tipy vpravo v horní liště se „sežíracím" přepínačem. Žárovka je pevná
 * kotva u pravého okraje, text je nalevo od ní. Na hover se žárovka posune doleva
 * a text se přepne na „Hide tips"; klik text ořezem sežere doprava do žárovky a
 * zůstane jen ona. Klik na žárovku tip zase odkryje (a „Hide tips" se ukáže až po
 * odjetí a novém najetí myší). Stav se ukládá do `config.showTips` (v syncu s
 * přepínačem v Nastavení). Animace je řízená imperativně přes ref (měření šířky
 * a přepínání transitions), stav zap/vyp drží React/config.
 */
export function TipsTicker(): JSX.Element {
  const showTips = useStore((s) => s.config?.showTips ?? true)
  const configLoaded = useStore((s) => !!s.config)
  const saveConfig = useStore((s) => s.saveConfig)

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const busy = useRef(false)
  const suppress = useRef(false) // potlač hover-label, dokud myš neodjede
  const hovering = useRef(false)
  const iRef = useRef(Math.floor(Math.random() * TIPS.length))
  const collapsedRef = useRef(!showTips)
  const applied = useRef<boolean | null>(null) // naposledy aplikovaný stav (kvůli StrictMode)
  const wipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setP = (px: number, animate = true): void => {
    const b = bodyRef.current
    if (!b) return
    if (!animate) b.style.transition = 'none'
    b.style.setProperty('--p', `${px}px`)
    if (!animate) {
      void b.offsetWidth // reflow, ať se „none" projeví, než se transition vrátí
      b.style.transition = ''
    }
  }
  const bodyW = (): number => bodyRef.current?.getBoundingClientRect().width ?? 0
  const setText = (t: string): void => {
    if (bodyRef.current) bodyRef.current.textContent = t
  }
  /** Rychlá fade výměna obsahu (rotace / hover ↔ tip). */
  const fadeSwap = (apply: () => void): void => {
    const b = bodyRef.current
    if (!b) return
    b.classList.add('tips__body--swap')
    window.setTimeout(() => {
      apply()
      b.classList.remove('tips__body--swap')
      refit() // nový text = jiná délka → přeměř, jestli se ještě vejde
    }, FADE_MS)
  }
  // Při hoveru podržíme šířku řádky (min-width = šířka tipu), aby se po přepnutí
  // na krátké „Hide tips" nezúžila a kurzor nevypadl ven → jinak flicker (žárovka
  // poskakuje enter/leave smyčkou).
  const reserve = (): void => {
    const b = bodyRef.current
    if (b) b.style.minWidth = `${b.getBoundingClientRect().width}px`
  }
  const release = (): void => {
    const b = bodyRef.current
    if (b) b.style.minWidth = ''
  }

  // Vejde se aktuální tip vedle žárovky? Když ne (úzké okno / vyšší UI scale, kde
  // zoom zmenší efektivní viewport), NEcháme ho ořízlý uprostřed věty — místo toho
  // schováme celý text (třída `tips--tight` → šířka 0) a necháme jen žárovku. Jakmile
  // je zase místo, tip se vrátí. `scrollWidth` drží přirozenou šířku i při width:0,
  // takže se měření nezacyklí (žádný flicker show/hide).
  const refit = (): void => {
    const root = rootRef.current
    const body = bodyRef.current
    if (!root || !body) return
    const bulbW = root.querySelector('.tips__bulb')?.getBoundingClientRect().width ?? 15
    const padR = parseFloat(getComputedStyle(root).paddingRight) || 0
    const avail = root.clientWidth - padR - bulbW - 9 /* margin-right těla */
    root.classList.toggle('tips--tight', body.scrollWidth > avail + 1)
  }

  // Aplikuj stav (collapse/expand). Animuje jen při SKUTEČNÉ změně oproti minule
  // (StrictMode remount → stejná hodnota → jen instantní set, žádná animace).
  useLayoutEffect(() => {
    if (!configLoaded) return undefined
    const collapsed = !showTips
    collapsedRef.current = collapsed
    const prev = applied.current
    applied.current = collapsed
    const animate = prev !== null && prev !== collapsed

    // Zruš případnou rozdělanou wipe animaci, ať dobíhající timeout nepřepíše
    // nově aplikovaný stav (jinak by ticker mohl zůstat prázdný).
    if (wipeTimer.current) {
      clearTimeout(wipeTimer.current)
      wipeTimer.current = null
    }

    if (!animate) {
      setText(collapsed ? '' : TIPS[iRef.current])
      setP(0, false)
      busy.current = false
      refit()
      return undefined
    }

    busy.current = true
    if (collapsed) {
      // sežer aktuální obsah (tip / „Hide tips") doprava do žárovky
      release() // uvolni rezervovanou šířku, ať se ukusuje reálný obsah, ne prázdno
      setP(bodyW(), true)
      wipeTimer.current = setTimeout(() => {
        setText('')
        setP(0, false)
        busy.current = false
        wipeTimer.current = null
      }, WIPE_MS)
    } else {
      // odkryj rovnou TIP (ne „Hide tips") a potlač hover, dokud myš neodjede
      suppress.current = true
      setText(TIPS[iRef.current])
      setP(bodyW(), false) // schované (clipnuté zprava)
      requestAnimationFrame(() => setP(0, true)) // odkryj
      wipeTimer.current = setTimeout(() => {
        busy.current = false
        wipeTimer.current = null
      }, WIPE_MS)
    }
    return () => {
      if (wipeTimer.current) {
        clearTimeout(wipeTimer.current)
        wipeTimer.current = null
      }
    }
  }, [showTips, configLoaded])

  // Rotace tipů — jen když je odkryto a nic se neděje (hover / animace).
  useEffect(() => {
    if (TIPS.length < 2) return undefined
    const id = setInterval(() => {
      if (collapsedRef.current || hovering.current || busy.current) return
      fadeSwap(() => {
        iRef.current = (iRef.current + 1) % TIPS.length
        setText(TIPS[iRef.current])
      })
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  // Přeměř vejití při každé změně šířky lišty — pokrývá resize okna i změnu UI
  // scale (zoom mění efektivní viewport, což ResizeObserver zachytí). Bez toho by
  // se tip po zvětšení scale tiše ořízl.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    // Při tažení za okraj okna chodí ResizeObserver prakticky v každém snímku.
    // Přeměřovat pokaždé je zbytečná práce navíc v už tak zatíženém pipeline —
    // sloučíme je do JEDNOHO přeměření na snímek (další volání se zahodí,
    // protože stav mezitím stejně nikdo nevidí).
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        refit()
      })
    })
    ro.observe(root)
    refit() // počáteční stav
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const onToggle = (): void => {
    if (busy.current) return
    busy.current = true // okamžitá pojistka; effect ho po animaci uvolní
    // collapsed → zapni tipy (true); odkryto → vypni (false). Když zápis configu
    // selže, effect se nespustí → uvolni pojistku sami, ať se toggle nezasekne.
    saveConfig({ showTips: collapsedRef.current }).catch(() => {
      busy.current = false
    })
  }
  const onEnter = (): void => {
    hovering.current = true
    if (!collapsedRef.current && !busy.current && !suppress.current) {
      reserve() // podrž šířku, ať se řádka nezúží (jinak flicker)
      fadeSwap(() => setText('Hide tips'))
    }
  }
  const onLeave = (): void => {
    hovering.current = false
    suppress.current = false
    if (!collapsedRef.current && !busy.current) {
      fadeSwap(() => {
        setText(TIPS[iRef.current])
        release()
      })
    }
  }

  return (
    <div className={`tips ${showTips ? 'tips--on' : ''}`} ref={rootRef}>
      <div
        className="tips__stage"
        role="button"
        tabIndex={0}
        aria-label={showTips ? 'Hide tips' : 'Show tips'}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <span className="tips__body" ref={bodyRef} />
        <span className="tips__bulb">
          {/* Vlastní SVG (ne generická Icon), ať jde sklo a patici obarvit zvlášť:
              sklo (baňka) svítí žlutě jen s .tips--on, patice je vždy bílá. */}
          <svg
            width={15}
            height={15}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="tipsBulbGlow" cx="50%" cy="45%" r="55%">
                <stop offset="0%" stopColor="#ffe08a" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ffe08a" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* měkká žlutá výplň jen uvnitř skla (nezasahuje k patici) */}
            <circle className="tips__bulb-fill" cx="12" cy="8.5" r="6.2" fill="url(#tipsBulbGlow)" stroke="none" />
            <path
              className="tips__bulb-glass"
              d="M15 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 6 8c0 1.3.5 2.5 1.5 3.5.8.8 1.3 1.5 1.5 2.5"
            />
            <path className="tips__bulb-base" d="M9 18h6" />
            <path className="tips__bulb-base" d="M10 21h4" />
          </svg>
        </span>
      </div>
    </div>
  )
}
