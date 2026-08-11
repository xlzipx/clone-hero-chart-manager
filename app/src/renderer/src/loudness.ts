/**
 * Měření hlasitosti mixu skladby pro normalizaci v přehrávači (EBU R128 / ITU-R
 * BS.1770). Vrací INTEGROVANOU hlasitost (LUFS) a sample peak — z nich přehrávač
 * spočítá jeden KONSTANTNÍ gain na celou skladbu. Konstantní násobek nemění
 * dynamiku ani zabarvení (není to komprese/limiter) — jen srovná pocitovou
 * hlasitost mezi skladbami, přesně jako ReplayGain / streamovací služby.
 *
 * Postup: stopy se dekódují, přes OfflineAudioContext se sečtou do jednoho mixu
 * @48 kHz (kontext sám doresampluje a smíchá), pak se změří. Hlasitost se počítá
 * na mono downmixu (konzistentní napříč mono i stereo skladbami), peak z obou
 * kanálů skutečného stereo výstupu (kvůli ochraně proti clippingu při zesílení).
 */

const SR = 48000

// Výpočet (biquad + smyčky) běží na hlavním vlákně → po blocích uvolni vlákno,
// ať UI (klikání, animace) zůstane plynulé i během měření dlouhé skladby.
const CHUNK = 1 << 19 // ~524k vzorků (~pár ms práce) mezi uvolněními
const yieldUI = (): Promise<void> => new Promise((r) => setTimeout(r))

// K-weighting (BS.1770-4) — dvě biquad fáze, koeficienty pro 48 kHz.
const STAGE1 = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585
}
const STAGE2 = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621
}

/** Naměřená hlasitost mixu. `lufs = -Infinity` u ticha (přehrávač to nechá bez gainu). */
export interface Loudness {
  lufs: number
  /** Lineární sample peak mixu (0..~1+). */
  peak: number
}

type Biquad = typeof STAGE1

/** Aplikuje jednu biquad fázi in-place (Direct Form I, sekvenčně — filtr je
 *  rekurzivní). Po blocích uvolní vlákno, ať dlouhá skladba neseká UI. */
async function biquadInPlace(x: Float32Array, c: Biquad): Promise<void> {
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let i = 0
  while (i < x.length) {
    const end = Math.min(i + CHUNK, x.length)
    for (; i < end; i++) {
      const xn = x[i]
      const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
      x2 = x1
      x1 = xn
      y2 = y1
      y1 = yn
      x[i] = yn
    }
    if (i < x.length) await yieldUI()
  }
}

/**
 * Integrovaná hlasitost K-weightovaného mono signálu (BS.1770 gating):
 * bloky 400 ms s 75% překryvem, absolutní brána −70 LKFS a relativní −10 LU.
 */
async function integratedLufs(mono: Float32Array): Promise<number> {
  const blockLen = Math.round(0.4 * SR) // 19200
  const hop = Math.round(0.1 * SR) // 4800 (blok = 4 hopy)
  const nSeg = Math.floor(mono.length / hop)
  if (nSeg < 4) return -Infinity

  // Součet čtverců po 100ms segmentech → blok = 4 sousední segmenty (O(N)).
  // Po ~CHUNK vzorcích uvolni vlákno (≈ každých 128 segmentů).
  const segSum = new Float64Array(nSeg)
  const segYield = Math.max(1, Math.floor(CHUNK / hop))
  for (let s = 0; s < nSeg; s++) {
    let acc = 0
    const base = s * hop
    for (let j = 0; j < hop; j++) {
      const v = mono[base + j]
      acc += v * v
    }
    segSum[s] = acc
    if (s % segYield === segYield - 1) await yieldUI()
  }

  const nBlocks = nSeg - 3
  const z = new Float64Array(nBlocks)
  for (let i = 0; i < nBlocks; i++) {
    z[i] = (segSum[i] + segSum[i + 1] + segSum[i + 2] + segSum[i + 3]) / blockLen
  }

  const GAMMA_A = -70
  // Absolutní brána → průměr přeživších.
  let sumAbs = 0
  let cntAbs = 0
  for (let i = 0; i < nBlocks; i++) {
    if (z[i] <= 0) continue
    const l = -0.691 + 10 * Math.log10(z[i])
    if (l >= GAMMA_A) {
      sumAbs += z[i]
      cntAbs++
    }
  }
  if (cntAbs === 0) return -Infinity

  // Relativní brána = −10 LU pod průměrem přeživších absolutní bránu.
  const gammaR = -0.691 + 10 * Math.log10(sumAbs / cntAbs) - 10
  let sumR = 0
  let cntR = 0
  for (let i = 0; i < nBlocks; i++) {
    if (z[i] <= 0) continue
    const l = -0.691 + 10 * Math.log10(z[i])
    if (l >= GAMMA_A && l >= gammaR) {
      sumR += z[i]
      cntR++
    }
  }
  if (cntR === 0) return -Infinity
  return -0.691 + 10 * Math.log10(sumR / cntR)
}

async function analyzeMixInner(urls: string[]): Promise<Loudness> {
  // Dekódovací kontext rovnou @48 kHz → dekódované buffery jsou na cílové
  // frekvenci a při renderu mixu už není potřeba další resample.
  const decodeCtx = new OfflineAudioContext(1, 1, SR)
  const buffers: AudioBuffer[] = []
  for (const url of urls) {
    const res = await fetch(url)
    const ab = await res.arrayBuffer()
    buffers.push(await decodeCtx.decodeAudioData(ab))
  }
  const maxLen = buffers.reduce((m, b) => Math.max(m, b.length), 0)
  if (maxLen === 0) return { lufs: -Infinity, peak: 0 }

  // Sečti všechny stopy do stereo mixu (OfflineAudioContext sečte i doresampluje).
  const oac = new OfflineAudioContext(2, maxLen, SR)
  for (const b of buffers) {
    const src = oac.createBufferSource()
    src.buffer = b
    src.connect(oac.destination)
    src.start(0)
  }
  const mix = await oac.startRendering()

  const L = mix.getChannelData(0)
  const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L
  const N = mix.length
  const mono = new Float32Array(N)
  let peak = 0
  // Mono downmix + peak po blocích (uvolňuje vlákno).
  let i = 0
  while (i < N) {
    const end = Math.min(i + CHUNK, N)
    for (; i < end; i++) {
      const l = L[i]
      const r = R[i]
      const al = l < 0 ? -l : l
      const ar = r < 0 ? -r : r
      if (al > peak) peak = al
      if (ar > peak) peak = ar
      mono[i] = 0.5 * (l + r)
    }
    if (i < N) await yieldUI()
  }

  // K-weighting (dvě fáze) a integrovaná hlasitost — vše chunkované.
  await biquadInPlace(mono, STAGE1)
  await biquadInPlace(mono, STAGE2)
  return { lufs: await integratedLufs(mono), peak }
}

// Serializace: měření je náročné (decode + DSP). Když poběží víc naráz (aktuální
// skladba + předpočítání další), sečetla by se paměť i zátěž a UI by sekalo.
// Řetěz zajistí, že běží vždy jen JEDNO měření.
let analysisChain: Promise<unknown> = Promise.resolve()

/**
 * Změří hlasitost mixu složeného z daných stop (URL na `chm-audio://`). Stopy se
 * dekódují, sečtou do jednoho mixu a změří. Běží serializovaně (jedno naráz) a
 * po blocích uvolňuje hlavní vlákno. Vyhazuje při chybě dekódování/fetch.
 */
export async function analyzeMix(urls: string[]): Promise<Loudness> {
  const run = analysisChain.then(
    () => analyzeMixInner(urls),
    () => analyzeMixInner(urls)
  )
  // Řetěz drží jen pořadí (spolkne chybu), výsledek/chyba jde volajícímu přes `run`.
  analysisChain = run.catch(() => undefined)
  return run
}
