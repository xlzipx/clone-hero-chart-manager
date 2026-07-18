// Platforma v rendereru — z preloadu (window.api.platform). Slouží k drobnému
// ladění UI mezi macOS a Windows (např. YARG je jen na Windows, jiné popisky cest).

export const IS_MAC = window.api.platform === 'darwin'
export const IS_WIN = window.api.platform === 'win32'
