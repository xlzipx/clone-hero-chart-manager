import { useEffect, useRef, useState } from 'react'
import { IS_MAC } from '../platform'

interface Props {
  value: string
  onChange: (accelerator: string) => void
}

const MODS = ['Control', 'Shift', 'Alt', 'Meta']

/** Zobrazení akcelerátoru pro uživatele. Na macu přeložíme Electron tokeny na
 *  nativní symboly (⌘⌥⌃⇧); uložená hodnota (Electron accelerator) zůstává stejná. */
const MAC_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Cmd: '⌘',
  Meta: '⌘',
  Super: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧'
}
function displayAccel(accel: string): string {
  if (!accel || !IS_MAC) return accel
  return accel.split('+').map((p) => MAC_SYMBOLS[p] ?? p).join('+')
}

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
  // Meta = Command na macu (Electron token „Command"), jinde Windows/Super klávesa.
  if (e.metaKey) mods.push(IS_MAC ? 'Command' : 'Super')

  let main: string
  if (k.length === 1) {
    // Non-ASCII (§, °, č, ě, …): Electron globalShortcut je nepřijme.
    if (!isAsciiPrintable(k)) {
      return {
        accel: null,
        reason: `“${k}” isn't supported — Electron global shortcuts allow only ASCII keys. Try F-keys (F1–F12) or a combo like ${IS_MAC ? '⌘⇧H' : 'Ctrl+Shift+H'}.`
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

/** Popisky kláves v keycapech (uložená hodnota zůstává Electron accelerator). */
const KEY_LABELS: Record<string, string> = { Control: 'Ctrl', Super: 'Win', Meta: 'Win', Return: 'Enter' }
function keyParts(accel: string): string[] {
  if (!accel) return []
  if (IS_MAC) return displayAccel(accel).split('+')
  return accel.split('+').map((p) => KEY_LABELS[p] ?? p)
}
function heldMods(e: React.KeyboardEvent): string[] {
  const m: string[] = []
  if (e.ctrlKey) m.push('Control')
  if (e.altKey) m.push('Alt')
  if (e.shiftKey) m.push('Shift')
  if (e.metaKey) m.push(IS_MAC ? 'Command' : 'Super')
  return m
}

function Keys({ parts }: { parts: string[] }): JSX.Element {
  return (
    <span className="hkrec__keys">
      {parts.map((p, i) => (
        <span key={i} className="hkrec__keywrap">
          {i ? <span className="hkrec__plus">+</span> : null}
          <kbd className="hkrec__key">{p}</kbd>
        </span>
      ))}
    </span>
  )
}

export function HotkeyInput({ value, onChange }: Props): JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [held, setHeld] = useState<string[]>([])
  const [warn, setWarn] = useState('')
  const pausedRef = useRef(false)

  // Pojistka: kdyby se pole odmountovalo se zaměřením (např. zavření Nastavení
  // klikem na pozadí), blur nemusí přijít → globální hotkeys by zůstaly vypnuté.
  useEffect(() => {
    return () => {
      if (pausedRef.current) void window.api.resumeHotkeys()
    }
  }, [])

  const invalid = value !== '' && !isAcceleratorValid(value)

  return (
    <div className="hotkey-wrap">
      <div className={`hkrec ${capturing ? 'hkrec--rec' : ''} ${invalid ? 'hkrec--invalid' : ''}`}>
        <button
          type="button"
          className="hkrec__field"
          aria-label={value ? `Shortcut ${displayAccel(value)}. Click to change` : 'No shortcut. Click to record one'}
          onFocus={() => {
            setCapturing(true)
            setHeld([])
            setWarn('')
            pausedRef.current = true
            window.api.pauseHotkeys() // ať F10/F9 nezasáhnou během zachytávání
          }}
          onBlur={() => {
            setCapturing(false)
            setHeld([])
            pausedRef.current = false
            window.api.resumeHotkeys()
          }}
          onKeyUp={(e) => setHeld(heldMods(e))}
          onKeyDown={(e) => {
            e.preventDefault()
            if (e.key === 'Escape') {
              // Escape = zrušit zachytávání (neměnit hodnotu)
              e.stopPropagation() // nesmí propadnout na window handler (zavřel by celá Nastavení)
              ;(e.currentTarget as HTMLButtonElement).blur()
              return
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
              onChange('')
              setWarn('')
              ;(e.currentTarget as HTMLButtonElement).blur()
              return
            }
            setHeld(heldMods(e))
            const { accel, reason } = toAccelerator(e)
            if (accel) {
              onChange(accel)
              setWarn('')
              ;(e.currentTarget as HTMLButtonElement).blur()
            } else if (reason) {
              setWarn(reason)
            }
          }}
        >
          {capturing ? (
            <>
              <span className="hkrec__dot" aria-hidden="true" />
              {held.length ? (
                <Keys parts={[...keyParts(held.join('+')), '…']} />
              ) : (
                <span className="hkrec__hint">Press a key or combo</span>
              )}
              <span className="hkrec__aside">Esc to cancel</span>
            </>
          ) : value ? (
            <>
              <Keys parts={keyParts(value)} />
              <span className="hkrec__aside">Click to change</span>
            </>
          ) : (
            <>
              <span className="hkrec__hint">Not set</span>
              <span className="hkrec__aside">Click to record</span>
            </>
          )}
        </button>
        {value && !capturing ? (
          <button
            type="button"
            className="hkrec__clear"
            title="Remove shortcut"
            aria-label="Remove shortcut"
            onClick={() => {
              onChange('')
              setWarn('')
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {warn ? <p className="hotkey-warn">⚠ {warn}</p> : null}
      {invalid && !warn ? (
        <p className="hotkey-warn">
          ⚠ Current hotkey contains characters that Electron can't register globally. Click and
          press a new key, or remove it.
        </p>
      ) : null}
    </div>
  )
}
