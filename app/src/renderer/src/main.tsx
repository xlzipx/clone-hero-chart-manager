import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Motiv je napevno „graphite" (nastaveno přes data-theme v index.html) — modrý
// motiv byl vyřazen. Žádné přepínání za běhu.

// Okno v pozadí (uživatel hraje): pozastavit nekonečné dekorativní animace.
// Obíhající okraj „hra běží" a podobné efekty se jinak překreslují v každém
// snímku i ve chvíli, kdy se na ně nikdo nedívá — na Macu (Retina, 120 Hz) to
// znatelně vytěžovalo CPU a baterii, když běžel Clone Hero současně s appkou.
// Stav okna posílá hlavní proces (události okna Electronu jsou spolehlivější
// než focus/blur stránky, zvlášť na macu a při skrytí do tray).
window.api.onWindowActive((active) => {
  document.documentElement.classList.toggle('app-blurred', !active)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
