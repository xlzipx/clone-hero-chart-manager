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
