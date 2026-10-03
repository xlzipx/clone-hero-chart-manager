import { useCallback, useEffect, useRef } from 'react'

/**
 * Zaškrtávací seznamy (setlist, duplicity, rozbité písně, import playlistu,
 * hromadná oprava) se ovládají stejně:
 * - klik na řádek nebo políčko přepne jednu položku,
 * - Shift+klik nastaví celý rozsah od naposledy kliknuté položky na stav, který
 *   ta položka má (jako zaškrtávátka v Průzkumníku).
 *
 * `order` = pořadí položek, jak je uživatel vidí. Vrací `toggle(id, shift)`.
 */
export function useRangeToggle<T>(
  order: T[],
  isOn: (id: T) => boolean,
  setMany: (ids: T[], on: boolean) => void
): (id: T, shift: boolean) => void {
  const anchor = useRef<T | null>(null)
  return useCallback(
    (id: T, shift: boolean) => {
      const a = anchor.current
      if (shift && a !== null) {
        const i = order.indexOf(a)
        const j = order.indexOf(id)
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i]
          setMany(order.slice(lo, hi + 1), isOn(a))
          anchor.current = id
          return
        }
      }
      setMany([id], !isOn(id))
      anchor.current = id
    },
    [order, isOn, setMany]
  )
}

/** Klik do řádku seznamu: tlačítka, odkazy a pole uvnitř řádku si klik nechávají. */
export function isRowClick(e: React.MouseEvent): boolean {
  return !(e.target as HTMLElement).closest('button, a, input, select, textarea, label')
}

/** Shift+mousedown by jinak označil text mezi řádky. */
export function noShiftSelect(e: React.MouseEvent): void {
  if (e.shiftKey) e.preventDefault()
}

/** `setMany` pro výběr držený jako `Set` ve stavu komponenty. */
export function setInSet<T>(set: React.Dispatch<React.SetStateAction<Set<T>>>): (ids: T[], on: boolean) => void {
  return (ids, on) =>
    set((c) => {
      const n = new Set(c)
      for (const id of ids) {
        if (on) n.add(id)
        else n.delete(id)
      }
      return n
    })
}

/**
 * Ctrl+A / Escape v zaškrtávacích obrazovkách (Setlists, Duplicates): vybrat vše
 * zobrazené / zrušit výběr. Mimo textová pole a jen když není otevřený dialog.
 */
export function useChecklistKeys(onSelectAll: () => void, onClear: () => boolean): void {
  const ref = useRef({ onSelectAll, onClear })
  ref.current = { onSelectAll, onClear }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      if (document.querySelector('.modal-overlay, .lib__dialog-overlay')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        ref.current.onSelectAll()
      } else if (e.key === 'Escape' && ref.current.onClear()) {
        e.stopImmediatePropagation()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Píše uživatel právě do pole? Zaškrtávací políčko, přepínač ani tlačítko se
 * nepočítají — po kliknutí na políčko musí klávesové zkratky dál fungovat.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
  if (t.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes((t as HTMLInputElement).type)
}
