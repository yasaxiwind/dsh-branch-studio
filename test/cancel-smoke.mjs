/**
 * Cancel smoke test: a queued branch and a running branch can be cancelled
 * individually, without touching the others.
 *
 *   node test/cancel-smoke.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-cancel-home-'))
process.env.DSH_HOME = stateHome
const workspace = mkdtempSync(join(tmpdir(), 'branch-cancel-'))
mkdirSync(join(workspace, 'src'), { recursive: true })
writeFileSync(join(workspace, 'src', 'a.txt'), 'hello\n', 'utf8')

const { apply } = await import('../index.js')
const routes = new Map()
const cleanups = []
let queuedAttempts = 0
let interrupts = 0
let resolveRunning = null
const agent = {
  id: 'session-cancel',
  session: { header: { id: 'session-cancel', cwd: workspace } },
  model: { current: () => ({ provider: 'p', model: 'm' }) },
  inject: () => {},
}
let childListener = null
const childSession = { header: { id: 'child-running', cwd: workspace } }
const childAgent = {
  id: 'child-running',
  session: childSession,
  ctx: {
    on: (event, listener) => {
      if (event === 'session/event') childListener = listener
      return () => { childListener = null }
    },
  },
}
const ctx = {
  logger: () => ({ info() {} }),
  effect: fn => {
    const dispose = fn()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  tools: { register: () => {} },
  connection: { fetch: { register: definition => routes.set(definition.path, definition) } },
  agents: { get: id => (id === 'session-cancel' ? agent : (id === 'child-running' ? childAgent : undefined)) },
  subagents: {
    startActivation: async spec => {
      if (spec.label.includes('QUEUED')) {
        queuedAttempts += 1
        const error = new Error('subagent limit reached (active child limit: 8)')
        error.code = 'ACTIVATION_LIMIT_REACHED'
        throw error
      }
      return {
        childId: 'child-running',
        result: new Promise(resolve => { resolveRunning = resolve }),
        dispose: async () => {},
      }
    },
    interrupt: () => {
      interrupts += 1
      resolveRunning?.({ output: [{ type: 'text', text: 'stopped' }], stopReason: 'aborted' })
    },
  },
  sessions: { get: () => ({}) },
  sessionProjections: { snapshot: () => ({ values: {} }) },
  workingDirectory: { get: () => workspace },
  tokenMeter: { measure: () => ({ totalTokens: 1 }) },
}

apply(ctx, { copyWarnMB: 0, maxCopyMB: 100, capacityRetryMs: 50, capacityWaitMs: 10000, sweepGraceMs: 0 })

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  return (await definition.fetch({ url: `http://local${path}`, async json() { return body } })).json()
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }
const waitStatus = async (groupId, wanted) => {
  for (let i = 0; i < 200; i += 1) {
    const state = await call('/api/branch-studio/state?sessionId=session-cancel')
    const group = state.groups.find(item => item.id === groupId)
    if (group && group.branches[0].status === wanted) return group
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  return null
}

// 1. A branch waiting for a subagent slot can be cancelled.
const queued = await call('/api/branch-studio/create', {
  sessionId: 'session-cancel',
  goal: 'queued',
  inherit: false,
  branches: [{ label: 'QUEUED', angle: 'wait' }],
})
assert(queued.ok === true, queued.error?.message)
assert(await waitStatus(queued.group.id, 'queued'), 'branch reached queued')
const before = queuedAttempts
await call('/api/branch-studio/cancel', { sessionId: 'session-cancel', branch: queued.group.branches[0].id })
const cancelledQueued = await waitStatus(queued.group.id, 'cancelled')
assert(cancelledQueued, 'queued branch cancelled')
await new Promise(resolve => setTimeout(resolve, 200))
assert(queuedAttempts <= before + 1, 'no further admission attempts after cancel')

// 2. A running branch can be cancelled; the child is interrupted.
const running = await call('/api/branch-studio/create', {
  sessionId: 'session-cancel',
  goal: 'running',
  inherit: false,
  branches: [{ label: 'RUNNING', angle: 'run' }],
})
assert(running.ok === true, running.error?.message)
assert(await waitStatus(running.group.id, 'running'), 'branch reached running')
childListener?.(childSession, { type: 'tool/call', data: { name: 'Read', arguments: '{"file_path":"a.txt"}' } })
const live = await call('/api/branch-studio/state?sessionId=session-cancel')
const liveBranch = live.groups.find(item => item.id === running.group.id)?.branches[0]
assert(liveBranch?.activity?.name === 'Read', 'live activity is reported while running')
await call('/api/branch-studio/cancel', { sessionId: 'session-cancel', branch: running.group.branches[0].id })
assert(interrupts === 1, `child interrupted once (got ${interrupts})`)
const cancelledRunning = await waitStatus(running.group.id, 'cancelled')
assert(cancelledRunning, 'running branch cancelled')
assert(cancelledRunning.branches[0].error === 'cancelled by user', 'cancel reason recorded')

// 3. The other branch is untouched and a completed branch cannot be cancelled.
const finished = await call('/api/branch-studio/create', {
  sessionId: 'session-cancel',
  goal: 'finished',
  inherit: false,
  branches: [{ label: 'DONE', angle: 'done' }],
})
assert(await waitStatus(finished.group.id, 'running'), 'finished branch running')
resolveRunning?.({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' })
assert(await waitStatus(finished.group.id, 'completed'), 'finished branch completed')
const completed = await call('/api/branch-studio/cancel', { sessionId: 'session-cancel', branch: finished.group.branches[0].id })
assert(completed.ok === false, 'completed branch cannot be cancelled')

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(workspace, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('cancel smoke: OK', { queuedAttempts, interrupts })
