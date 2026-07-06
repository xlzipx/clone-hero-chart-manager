// Kontrola nové verze přes GitHub Releases API.
//
// Zavolá se při startu appky. Porovná aktuální verzi (app.getVersion())
// s nejnovějším releasem v repozitáři. Chyby jsou tiché (offline, rate-limit) —
// vrací null, UI nic neukáže.

import { app } from 'electron'
import type { ReleaseNotes, UpdateInfo } from '../../shared/types'

const REPO = 'xlzipx/clone-hero-chart-manager'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** Načte poznámky k vydání dané verze (default aktuální) z GitHub Releases. */
export async function getReleaseNotes(version?: string): Promise<ReleaseNotes | null> {
  const v = (version || app.getVersion()).replace(/^v/i, '')
  const tag = `v${v}`
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CHM/${v}` }
    })
    if (!res.ok) return null
    const j = (await res.json()) as { name?: string; body?: string; html_url?: string }
    return {
      version: v,
      name: j.name || tag,
      body: j.body || '',
      url: j.html_url || `https://github.com/${REPO}/releases/tag/${tag}`
    }
  } catch {
    return null
  }
}

/**
 * Poznámky k VÍCE vydáním najednou. Když je zadán `sinceVersion`, vrátí všechny
 * releasy novější než ta verze — tj. souhrn všeho, co uživatel od svého updatu
 * minul (dynamicky podle toho, z jaké verze přichází). Bez `sinceVersion` vrátí
 * posledních `max` vydání. Vždy nejnovější první, ořezáno na `max`.
 */
export async function getReleaseNotesSince(
  sinceVersion?: string,
  max = 8
): Promise<ReleaseNotes[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CHM/${app.getVersion()}` }
    })
    if (!res.ok) return []
    const arr = (await res.json()) as Array<{
      tag_name?: string
      name?: string
      body?: string
      html_url?: string
      draft?: boolean
      prerelease?: boolean
      published_at?: string
    }>
    const notes: ReleaseNotes[] = arr
      .filter((r) => !!r.tag_name && !r.draft && !r.prerelease)
      .map((r) => {
        const version = (r.tag_name as string).replace(/^v/i, '')
        return {
          version,
          name: r.name || `v${version}`,
          body: r.body || '',
          url: r.html_url || `https://github.com/${REPO}/releases/tag/${r.tag_name}`,
          date: r.published_at
        }
      })
    // Pro jistotu seřaď podle verze (nejnovější první). Validní komparátor
    // (vrací i 0 při shodě), ať je řazení stabilní.
    notes.sort((a, b) =>
      isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0
    )
    const filtered = sinceVersion ? notes.filter((n) => isNewer(n.version, sinceVersion)) : notes
    return filtered.slice(0, max)
  } catch {
    return []
  }
}

/** "v0.2.4" | "0.2.4" → [0, 2, 4]. Nečíselné části se ignorují. */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => Number.isFinite(n))
}

/** Vrací true, pokud je `latest` novější než `current` (semver po částech). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = app.getVersion()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `CHM/${current}`
      },
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) return null

    const json = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean }
    const tag = json.tag_name
    if (!tag || json.draft) return null

    const latest = tag.replace(/^v/i, '')
    return {
      current,
      latest,
      hasUpdate: isNewer(latest, current),
      url: json.html_url || RELEASES_PAGE
    }
  } catch {
    // Offline / timeout / rate-limit — tiše ignorovat.
    return null
  }
}
