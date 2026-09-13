// Stages the `sc` CLI as a Tauri sidecar for local desktop builds.
//
// Release builds of the desktop app only accept the `sc` binary that sits next
// to the app executable, so the CLI ships inside the bundle. Tauri expects the
// sidecar at `src-tauri/binaries/sc-<target-triple>`; CI stages the binary it
// built in the CLI job, this script does the same thing for local builds.
//
// Usage: npm run sidecar        (from the `desktop` directory)

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(desktopDir, '..')
const binariesDir = join(desktopDir, 'src-tauri', 'binaries')

const hostTriple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  .split('\n')
  .find((line) => line.startsWith('host:'))
  ?.replace('host:', '')
  .trim()

if (!hostTriple) {
  console.error('could not determine the host target triple from `rustc -vV`')
  process.exit(1)
}

const exeSuffix = process.platform === 'win32' ? '.exe' : ''
const built = join(repoDir, 'target', 'release', `sc${exeSuffix}`)

if (!existsSync(built)) {
  console.log('building the sc CLI in release mode…')
  execFileSync('cargo', ['build', '--release', '--locked'], {
    cwd: repoDir,
    stdio: 'inherit',
  })
}

mkdirSync(binariesDir, { recursive: true })
const staged = join(binariesDir, `sc-${hostTriple}${exeSuffix}`)
copyFileSync(built, staged)
console.log(`staged ${staged}`)
