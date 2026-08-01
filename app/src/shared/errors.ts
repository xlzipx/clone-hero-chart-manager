/**
 * Práce s chybami typu `unknown` — JEDEN zdroj pravdy sdílený main i rendererem.
 *
 * `catch (e)` má v TS typ `unknown`, takže na každém místě, kde chceme text nebo
 * skutečný `Error`, se opakoval tentýž ternární výraz. Tady je jednou; volání pak
 * čte líp a nemůže se rozejít (dřív žilo 25× po codebase).
 */

/** Bezpečně vytáhne lidsky čitelný text z chycené chyby. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Zaručí `Error` instanci — hodí se před `reject(...)` / `throw ...`, kde chceme
 *  vždy pořádný Error (se stackem), i když nám přišlo něco jiného. */
export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * Electron u chyb přes IPC obalí původní text vlastní hlavičkou:
 * `Error invoking remote method 'search': Error: …`. Uživateli to nic neříká.
 */
const IPC_WRAP = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/

/**
 * Text chyby určený UŽIVATELI — bez vnitřností Electronu a s vysvětlením tam,
 * kde příčina není u nás. Výpadek katalogu je nejčastější případ: uživatel by
 * jinak viděl „HTTP 502" a myslel si, že je rozbitá appka.
 */
export function userMsg(e: unknown): string {
  const raw = errMsg(e).replace(IPC_WRAP, '').trim()

  const api = /(RhythmVerse|Chorus Encore) API returned HTTP (\d{3})/i.exec(raw)
  if (api) {
    const service = api[1]
    const code = Number(api[2])
    if (code >= 500) {
      return `${service} is temporarily down (server error ${code}). Nothing is wrong on your side, try again later.`
    }
    if (code === 429) {
      return `${service} is getting too many requests right now. Wait a moment and try again.`
    }
    return `${service} could not be reached (HTTP ${code}).`
  }

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(raw)) {
    return 'No connection to the internet. Check your network and try again.'
  }
  return raw
}
