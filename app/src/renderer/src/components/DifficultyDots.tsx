import { useState } from 'react'
import { useStore } from '../store'
import { MAX_DIFFICULTY } from '../utils'

/**
 * Klikací kolečka obtížnosti (1–6). Klik na N nastaví PŘESNOU obtížnost N
 * (min=max=N), klik na už vybrané N filtr zruší (rozsah 0–6).
 * Při najetí myší se kolečka plynule vyplní jako náhled.
 */
export function DifficultyDots({ disabled }: { disabled?: boolean }): JSX.Element {
  const diffMin = useStore((s) => s.diffMin)
  const diffMax = useStore((s) => s.diffMax)
  const setDiffRange = useStore((s) => s.setDiffRange)
  const [hover, setHover] = useState(0)

  // Vybarvená přesná obtížnost (jen když je min == max), jinak nic.
  const exact = diffMin === diffMax ? diffMin : 0
  const filled = hover > 0 ? hover : exact

  return (
    <span
      className={`diffdots ${disabled ? 'diffdots--off' : ''}`}
      onMouseLeave={() => setHover(0)}
    >
      {Array.from({ length: MAX_DIFFICULTY }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          className={`ddot ${n <= filled ? 'ddot--on' : ''}`}
          title={`Exact intensity ${n}`}
          onMouseEnter={() => !disabled && setHover(n)}
          onClick={() => {
            if (disabled) return
            if (diffMin === n && diffMax === n) setDiffRange(0, MAX_DIFFICULTY)
            else setDiffRange(n, n)
          }}
        />
      ))}
    </span>
  )
}
