// Historie obrazovek (Search / Library / Settings) pro Zpět / Vpřed — boční
// tlačítka myši a Alt+šipky, jako v prohlížeči. Procházení složek uvnitř
// knihovny má vlastní historii v LibraryView; když dojde na její začátek nebo
// konec, pokračuje se tady.

import { useStore } from './store'

/** Nastavení leží nad hledáním nebo knihovnou → pamatuje si, nad čím bylo. */
type Screen = 'search' | 'library' | 'settings@search' | 'settings@library'

const hist: Screen[] = []
let pos = -1
/** Právě se přepíná podle historie → změny nezapisovat jako nové. */
let applying = false
/** Poslední zaznamenaná obrazovka (odběr store hlásí i nesouvisející změny). */
let last: Screen = 'search'

const current = (): Screen => {
  const st = useStore.getState()
  const base = st.showLibrary ? 'library' : 'search'
  return st.showSettings ? `settings@${base}` : base
}

function record(cur: Screen): void {
  if (hist[pos] === cur) return
  // Návrat na sousední obrazovku jinou cestou (Escape, křížek, tlačítko v liště)
  // se chová jako Zpět / Vpřed — historie za ní se nezahodí.
  if (hist[pos - 1] === cur) pos--
  else if (hist[pos + 1] === cur) pos++
  else {
    hist.splice(pos + 1)
    hist.push(cur)
    if (hist.length > 50) hist.shift()
    pos = hist.length - 1
  }
}

/** Začne sledovat přepínání obrazovek; vrací odhlášení. */
export function startScreenHistory(): () => void {
  last = current()
  record(last)
  return useStore.subscribe(() => {
    if (applying) return
    const cur = current()
    if (cur === last) return
    last = cur
    record(cur)
  })
}

/** Krok v historii obrazovek; false = dál už nic není. */
export function screenGo(step: -1 | 1): boolean {
  const to = pos + step
  if (to < 0 || to >= hist.length) return false
  pos = to
  const target = hist[to]
  if (target === current()) return true
  const st = useStore.getState()
  const lib = target === 'library' || target === 'settings@library'
  applying = true
  try {
    if (lib !== st.showLibrary) st.setShowLibrary(lib) // zavře i Nastavení
    if (target.startsWith('settings@')) st.setShowSettings(true)
    else if (useStore.getState().showSettings) st.setShowSettings(false)
  } finally {
    applying = false
  }
  last = current()
  return true
}
