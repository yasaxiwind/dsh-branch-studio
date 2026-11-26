/**
 * Security boundary smoke test: branch tools reject subagent callers, routes
 * reject cross-session ids, and archive never deletes a workspace outside the
 * studio root even if state is corrupted.
 *
 *   node test/security-smoke.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-security-home-'))
process.env.DSH_HOME = stateHome
const workspace = mkdtempSync(join(tmpdir(), 'branch-security-ws-'))
const victim = mkdtempSync(join(tmpdir(), 'branch-security-victim-'))
mkdirSync(join(workspace, 'src'), { recursive: true })
writeFileSync(join(workspace, 'src', 'a.txt'), 'original\n', 'utf8')
writeFileSync(join(victim, 'keep.txt'), 'do not delete\n', 'utf8')

const studio = join(workspace, '.dsh-branch-studio')
const stateFile = join(stateHome, 'branch-studio', 'state.json')
mkdirSync(join(stateHome, 'branch-studio'), { recursive: true })
writeFileSync(stateFile, JSON.stringify({
  version: 1,
  roots: [workspace],
  groups: [{
    id: 'g_evil',
    sessionId: 'session-top',
    title: 'corrupted',
    goal: 'x',
    cwd: workspace,
    mode: 'copy',
    repo: null,
    createdAt: Date.now() - 1000,
    branches: [{ id: 'b_evil', label: 'X', status: 'completed', workspace: victim }],
  }],
}, null, 2), 'utf8')

const { apply } = await import('../index.js')
const routes = new Map()
const tools = new Map()
const cleanups = []
const topAgent = {
  id: 'session-top',
  session: { header: { id: 'session-top', cwd: workspace } },
  model: { current: () => ({ provider: 'p', model: 'm' }) },
  inject: () => {},
}
const childAgent = {
  id: 'session-child',
  session: { header: { id: 'session-child', cwd: workspace, parentSession: 'session-top' } },
  model: { current: () => ({ provider: 'p', model: 'm' }) },
  inject: () => {},
}
const ctx = {
  logger: () => ({ info() {} }),
  effect: fn => {
    const dispose = fn()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  tools: { register: definition => tools.set(definition.name, definition) },
  connection: { fetch: { register: definition => routes.set(definition.path, definition) } },
  agents: { get: id => (id === 'session-top' ? topAgent : id === 'session-child' ? childAgent : undefined) },
  subagents: {
    startActivation: async spec => {
      writeFileSync(join(spec.cwd, 'src', 'a.txt'), 'changed\n', 'utf8')
      return {
        childId: `child-${Date.now()}`,
        result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
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
apply(ctx, { copyWarnMB: 0, maxCopyMB: 100, sweepGraceMs: 0 })

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  return (await definition.fetch({ url: `http://local${path}`, async json() { return body } })).json()
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }
const childExec = { agent: childAgent }
const topExec = { agent: topAgent }

// 1. Subagents cannot start / archive / promote.
for (const name of ['branch_start', 'branch_archive', 'branch_promote']) {
  let rejected = false
  try {
    await tools.get(name).execute(name === 'branch_start'
      ? { goal: 'x', branches: [{ label: 'A', angle: 'x' }] }
      : name === 'branch_archive' ? { group: 'g_evil' } : { branch: 'b_evil' }, childExec)
  } catch (error) {
    rejected = /top-level conversation/.test(error.message)
  }
  assert(rejected, `${name} rejected for a subagent caller`)
}

// 2. Cross-session route access is refused.
const wrong = await call('/api/branch-studio/archive', { sessionId: 'session-other', group: 'g_evil' })
assert(wrong.ok === false, 'archive with a wrong session is refused')
assert(existsSync(join(victim, 'keep.txt')), 'victim file untouched after refused archive')

// 3. Even the owning session cannot delete a workspace outside the studio root.
const archived = await call('/api/branch-studio/archive', { sessionId: 'session-top', group: 'g_evil' })
assert(archived.ok === true, `corrupted group removed: ${archived.error?.message}`)
assert(existsSync(victim), 'workspace outside the studio root was not deleted')

// 4. Top-level promote still works.
const created = await call('/api/branch-studio/create', {
  sessionId: 'session-top',
  goal: 'change the file',
  inherit: false,
  branches: [{ label: 'A', angle: 'change it' }],
})
assert(created.ok === true, `create: ${created.error?.message}`)
let group
for (let i = 0; i < 100; i += 1) {
  const state = await call('/api/branch-studio/state?sessionId=session-top')
  group = state.groups.find(item => item.id === created.group.id)
  if (group && group.branches[0].status === 'completed') break
  await new Promise(resolve => setTimeout(resolve, 30))
}
assert(group?.branches?.[0]?.status === 'completed', 'branch completed')
let rejectedPromote = false
try {
  await tools.get('branch_promote').execute({ branch: group.branches[0].id }, childExec)
} catch (error) {
  rejectedPromote = /top-level conversation/.test(error.message)
}
assert(rejectedPromote, 'promote from a subagent rejected')
await tools.get('branch_promote').execute({ branch: group.branches[0].id }, topExec)
assert(readFileSync(join(workspace, 'src', 'a.txt'), 'utf8') === 'changed\n', 'top-level promote applied the change')

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(workspace, { recursive: true, force: true })
rmSync(victim, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('security smoke: OK')
