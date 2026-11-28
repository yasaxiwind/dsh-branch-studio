/**
 * Settings smoke test: defaults, validation, persistence and profile overrides.
 *
 *   node test/settings-smoke.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-settings-home-'))
process.env.DSH_HOME = stateHome
const { apply } = await import('../index.js')

const cleanups = []
const routes = new Map()
function fakeCtx() {
  return {
    logger: () => ({ info() {} }),
    effect: fn => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    tools: { register: () => {} },
    connection: { fetch: { register: definition => routes.set(definition.path, definition) } },
    agents: { get: () => undefined },
    subagents: { startActivation: async () => { throw new Error('not used') }, interrupt: () => {} },
    sessions: { get: () => undefined },
    sessionProjections: { snapshot: () => ({ values: {} }) },
    workingDirectory: { get: () => process.cwd() },
    tokenMeter: { measure: () => ({ totalTokens: 0 }) },
  }
}

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  return (await definition.fetch({ url: `http://local${path}`, async json() { return body } })).json()
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }

apply(fakeCtx(), { sweepGraceMs: 0 })
let meta = await call('/api/branch-studio/meta?sessionId=session-settings')
assert(meta.settings.copyWarnMB === 300, 'default copyWarnMB')
assert(meta.settings.capacityWaitMs === 300000, 'default capacityWaitMs')
assert(meta.settings.linkDeps === true, 'default linkDeps')
assert(meta.settings.verifyAfter === true, 'default verifyAfter')

const saved = await call('/api/branch-studio/settings', {
  settings: { copyWarnMB: 512, capacityWaitMs: 12000, linkDeps: false, verifyAfter: false },
})
assert(saved.ok === true, 'settings save ok')
assert(saved.settings.copyWarnMB === 512 && saved.settings.linkDeps === false && saved.settings.verifyAfter === false, 'saved values returned')
meta = await call('/api/branch-studio/meta?sessionId=session-settings')
assert(meta.settings.copyWarnMB === 512 && meta.settings.capacityWaitMs === 12000, 'saved values in meta')
const file = join(stateHome, 'branch-studio', 'settings.json')
const onDisk = JSON.parse(readFileSync(file, 'utf8'))
assert(onDisk.copyWarnMB === 512 && onDisk.verifyAfter === false, 'settings persisted')

const invalid = await call('/api/branch-studio/settings', { settings: { copyWarnMB: 99999 } })
assert(invalid.ok === false, 'out-of-range copyWarnMB rejected')

// A new apply() with a profile value must expose it as locked and refuse edits.
routes.clear()
apply(fakeCtx(), { sweepGraceMs: 0, copyWarnMB: 777 })
meta = await call('/api/branch-studio/meta?sessionId=session-settings')
assert(meta.settings.copyWarnMB === 777, 'profile value wins')
assert(meta.settings.locked.includes('copyWarnMB'), 'profile value is locked')
assert(meta.settings.capacityWaitMs === 12000, 'saved value still applies to unlocked fields')
const locked = await call('/api/branch-studio/settings', { settings: { copyWarnMB: 500 } })
assert(locked.ok === false, 'locked setting is rejected')

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(stateHome, { recursive: true, force: true })
console.log('settings smoke: OK')
