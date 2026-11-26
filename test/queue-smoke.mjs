/**
 * Capacity smoke test: when the subagent tree is full, a branch must wait for
 * a slot instead of failing immediately, then run once one frees up.
 *
 *   node test/queue-smoke.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-studio-queue-home-'))
process.env.DSH_HOME = stateHome
const { apply } = await import('../index.js')

const workspace = mkdtempSync(join(tmpdir(), 'branch-studio-queue-'))
mkdirSync(join(workspace, 'src'), { recursive: true })
writeFileSync(join(workspace, 'src', 'a.txt'), 'a\n', 'utf8')

const routes = new Map()
const cleanups = []
let attempts = 0
const agent = {
  id: 'session-q',
  session: { header: { id: 'session-q', cwd: workspace } },
  model: { current: () => ({ provider: 'p', model: 'm' }) },
  inject: () => {},
}
const ctx = {
  logger: () => ({ info() {} }),
  effect: fn => {
    const dispose = fn()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  tools: { register: () => {} },
  connection: { fetch: { register: definition => routes.set(definition.path, definition) } },
  agents: { get: id => (id === 'session-q' ? agent : undefined) },
  subagents: {
    startActivation: async () => {
      attempts += 1
      if (attempts <= 2) {
        const error = new Error('subagent limit reached (active child limit: 8); wait for an existing child to finish')
        error.code = 'ACTIVATION_LIMIT_REACHED'
        throw error
      }
      return {
        childId: 'child-q',
        result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
    interrupt: () => {},
  },
  sessions: { get: () => ({}) },
  sessionProjections: { snapshot: () => ({ values: {} }) },
  workingDirectory: { get: () => workspace },
  tokenMeter: { measure: () => ({ totalTokens: 10 }) },
}

apply(ctx, { capacityRetryMs: 10, capacityWaitMs: 5000, maxCopyMB: 100 })

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  const payload = await (await definition.fetch({
    url: `http://local${path}`,
    async json() { return body },
  })).json()
  if (payload.ok !== true) throw new Error(payload.error?.message ?? 'route failed')
  return payload
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }

const created = await call('/api/branch-studio/create', {
  sessionId: 'session-q',
  goal: 'wait for a slot',
  branches: [{ label: 'Q', angle: 'wait' }],
})
assert(created.group.branches[0].status === 'preparing', 'starts as preparing')

let group
let sawQueued = false
for (let i = 0; i < 100; i += 1) {
  const state = await call('/api/branch-studio/state?sessionId=session-q')
  group = state.groups[0]
  if (group?.branches[0]?.status === 'queued') sawQueued = true
  if (group && (group.branches[0].status === 'completed' || group.branches[0].status === 'error')) break
  await new Promise(resolve => setTimeout(resolve, 30))
}
assert(sawQueued, 'observed the queued state while the tree was full')
assert(attempts >= 3, `retried until admitted (attempts=${attempts})`)
assert(group?.branches[0]?.status === 'completed', `completed after admission: ${group?.branches[0]?.status} ${group?.branches[0]?.error}`)

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(workspace, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('queue smoke: OK', { attempts, sawQueued })
