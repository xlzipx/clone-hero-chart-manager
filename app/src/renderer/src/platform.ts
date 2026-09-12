// Platforma v rendereru — z preloadu (window.api.platform). Slouží k drobnému
// ladění UI mezi macOS, Windows a Linuxem (např. popisky cest, YARG má nativní
// build všude, ale Clone Hero na Linuxu jen přes Proton/Wine).

export const IS_MAC = window.api.platform === 'darwin'
export const IS_WIN = window.api.platform === 'win32'
export const IS_LINUX = window.api.platform === 'linux'
