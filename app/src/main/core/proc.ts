// Pomocník pro spouštění externích procesů.

import { spawn } from 'child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function run(
  exe: string,
  args: string[],
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void,
  signal?: AbortSignal
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Už zrušeno, než se vůbec spustilo → nevytvářej proces.
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    // stdin = 'ignore': dítě uvidí na stdin okamžitě EOF, takže se nezasekne
    // čekáním na vstup (např. 7z prompt "Enter password" u šifrovaného archivu),
    // což by jinak zablokovalo CELOU frontu úloh (pump na job čeká).
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    // Zrušení úlohy → zabij proces (konverze onyx trvá minuty; jinak by uživatel
    // čekal na doběhnutí). `close` handler pak resolve s nenulovým kódem a volající
    // (onyxConvert) hodí chybu, kterou runJob interpretuje jako zrušení.
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    let stdout = ''
    let stderr = ''
    let stdoutBuf = ''
    let stderrBuf = ''

    const handle = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      if (stream === 'stdout') stdout += text
      else stderr += text
      if (!onLine) return
      if (stream === 'stdout') {
        stdoutBuf += text
        let i: number
        while ((i = stdoutBuf.indexOf('\n')) >= 0) {
          onLine(stdoutBuf.slice(0, i).replace(/\r$/, ''), 'stdout')
          stdoutBuf = stdoutBuf.slice(i + 1)
        }
      } else {
        stderrBuf += text
        let i: number
        while ((i = stderrBuf.indexOf('\n')) >= 0) {
          onLine(stderrBuf.slice(0, i).replace(/\r$/, ''), 'stderr')
          stderrBuf = stderrBuf.slice(i + 1)
        }
      }
    }

    child.stdout.on('data', (c) => handle(c, 'stdout'))
    child.stderr.on('data', (c) => handle(c, 'stderr'))
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
