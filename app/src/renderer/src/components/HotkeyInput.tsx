import { useState } from 'react'

interface Props {
  value: string
  onChange: (accelerator: string) => void
}

const MODS = ['Control', 'Shift', 'Alt', 'Meta']

/** Electron globalShortcut povoluje jen ASCII printable znaky + speciální tokeny. */
function isAsciiPrintable(s: string): boolean {
  return /^[\x20-\x7e]+$/.test(s)
}

export function isAcceleratorValid(s: string): boolean {
  if (!s) return false
  return s.split('+').every((part) => isAsciiPrintable(part))
}

/** Převede stisk klávesy na Electron akcelerátor (např. "Control+Shift+H", "F10"). */
function toAccelerator(e: React.KeyboardEvent): { accel: string | null; reason?: string } {
  const k = e.key
  if (MODS.includes(k)) return { accel: null } // čekáme na nemodifikátorovou klávesu

  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')

  let main: string
  if (k.length === 1) {
    // Non-ASCII (§, °, č, ě, …): Electron globalShortcut je nepřijme.
    if (!isAsciiPrintable(k)) {
      return {
        accel: null,
        reason: `“${k}” isn't supported — Electron global shortcuts allow only ASCII keys. Try F-keys (F1–F12) or a combo like Ctrl+Shift+H.`
      }
    }
    main = k.toUpperCase()
  } else if (/^F\d{1,2}$/.test(k)) main = k
  else if (k.startsWith('Arrow')) main = k.slice(5) // ArrowUp → Up
  else if (k === ' ') main = 'Space'
  else if (k === 'Enter') main = 'Return'
  else main = k // Tab, Delete, Home, PageUp, …

  return { accel: [...mods, main].join('+') }
}

export function HotkeyInput({ value, onChange }: Props): JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [warn, setWarn] = useState('')

  const invalid = value !== '' && !isAcceleratorValid(value)

  return (
    <div className="hotkey-wrap">
      <input
        className={`hotkey-input ${invalid ? 'hotkey-input--invalid' : ''}`}
        readOnly
        value={capturing ? 'Press a key or combo…' : value}
        placeholder="Click and press a key/combo"
        onFocus={() => {
          setCapturing(true)
          setWarn('')
          window.api.pauseHotkeys() // ať F10/F9 nezasáhnou během zachytávání
        }}
        onBlur={() => {
          setCapturing(false)
          window.api.resumeHotkeys()
        }}
        onKeyDown={(e) => {
          e.preventDefault()
          if (e.key === 'Escape') {
            // Escape = zrušit zachytávání (neměnit hodnotu)
            e.stopPropagation() // nesmí propadnout na window handler (zavřel by celá Nastavení)
            ;(e.currentTarget as HTMLInputElement).blur()
            return
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            onChange('')
            setWarn('')
            return
          }
          const { accel, reason } = toAccelerator(e)
          if (accel) {
            onChange(accel)
            setWarn('')
            ;(e.currentTarget as HTMLInputElement).blur()
          } else if (reason) {
            setWarn(reason)
          }
        }}
      />
      {warn ? <p className="hotkey-warn">⚠ {warn}</p> : null}
      {invalid && !warn ? (
        <p className="hotkey-warn">
          ⚠ Current hotkey contains characters that Electron can't register globally. Click and
          press a new key or Backspace to clear.
        </p>
      ) : null}
    </div>
  )
}
