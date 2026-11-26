/**
 * Maintenance smoke test: large-copy gate, startup sweep of orphan studio
 * directories, stale running branches, and bounded state retention.
 *
 *   node test/maintenance-smoke.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-studio-maint-home-'))
process.env.DSH_HOME = stateHome
const workspace = mkdtempSync(join(tmpdir(), 'branch-studio-maint-'))
mkdirSync(join(workspace, 'src'), { recursive: true })
writeFileSync(join(workspace, 'src', 'a.txt'), 'hello\n', 'utf8')
writeFileSync(join(workspace, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 1))

const studio = join(workspace, '.dsh-branch-studio')
const oldDir = join(studio, 'g_old', 'b_old')
const liveDir = join(studio, 'g_live', 'b_live')
const orphanDir = join(studio, 'g_orphan', 'b_orphan')
const ghostDir = join(studio, 'g_live', 'b_ghost')
const ghostManifest = join(studio, 'g_live', 'b_ghost.base.json')
for (const dir of [oldDir, liveDir, orphanDir, ghostDir]) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'file.txt'), 'x\n', 'utf8')
}
writeFileSync(ghostManifest, '{}', 'utf8')

const now = Date.now()
const oldCreated = now - 30 * 86400000
const stateFile = join(stateHome, 'branch-studio', 'state.json')
mkdirSync(join(stateHome, 'branch-studio'), { recursive: true })
writeFileSync(stateFile, JSON.stringify({
  version: 1,
  roots: [workspace],
  groups: [
    {
      id: 'g_old', sessionId: 's', title: 'old', goal: 'old', cwd: workspace, mode: 'copy', repo: null,
      createdAt: oldCreated,
      branches: [{ id: 'b_old', label: 'A', status: 'completed', workspace: oldDir }],
    },
    {
      id: 'g_live', sessionId: 's', title: 'was running', goal: 'live', cwd: workspace, mode: 'copy', repo: null,
      createdAt: now,
      branches: [{ id: 'b_live', label: 'B', status: 'running', workspace: liveDir }],
    },
  ],
}, null, 2), 'utf8')

const { apply } = await import('../index.js')
const routes = new Map()
const cleanups = []
const agent = {
  id: 'session-m',
  session: { header: { id: 'session-m', cwd: workspace } },
  model: { current: () => ({ provider: 'p', model: 'm' }) },
  inject: () => {},
}
let activations = 0
const ctx = {
  logger: () => ({ info() {} }),
  effect: fn => {
    const dispose = fn()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
  tools: { register: () => {} },
  connection: { fetch: { register: definition => routes.set(definition.path, definition) } },
  agents: { get: id => (id === 'session-m' ? agent : undefined) },
  subagents: {
    startActivation: async () => {
      activations += 1
      return {
        childId: `child-${activations}`,
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

apply(ctx, {
  copyWarnMB: 1,
  maxCopyMB: 100,
  maxCopyFiles: 10000,
  copyPollMs: 50,
  keepGroups: 1,
  keepDays: 0,
  sweepGraceMs: 0,
})

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  return (await definition.fetch({ url: `http://local${path}`, async json() { return body } })).json()
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'))

// Startup sweep: orphan group, ghost branch directory and stale manifest go;
// known branches stay; a stale running branch becomes interrupted.
assert(!existsSync(orphanDir), 'orphan group directory removed')
assert(!existsSync(ghostDir), 'branch directory without a record removed')
assert(!existsSync(ghostManifest), 'base manifest without a branch removed')
assert(existsSync(oldDir), 'known old branch kept')
assert(existsSync(liveDir), 'known interrupted branch kept')
const loaded = readState()
assert(loaded.groups.find(group => group.id === 'g_live').branches[0].status === 'interrupted', 'running branch marked interrupted')

// Copy gate: over copyWarnMB without confirmCopy is refused.
const blocked = await call('/api/branch-studio/create', {
  sessionId: 'session-m',
  goal: 'blocked copy',
  branches: [{ label: 'A', angle: 'do it' }],
})
assert(blocked.ok === false, 'large copy without confirmation is refused')
assert(String(blocked.error?.message ?? '').includes('comfort limit'), `gate message mentions the limit: ${blocked.error?.message}`)
assert(readState().groups.length === 2, 'refused create did not add a group')

// With explicit confirmation it proceeds, and retention drops the old group.
const created = await call('/api/branch-studio/create', {
  sessionId: 'session-m',
  goal: 'confirmed copy',
  confirmCopy: true,
  branches: [{ label: 'C', angle: 'do it' }],
})
assert(created.ok === true, `confirmed create succeeded: ${created.error?.message}`)

let group
for (let i = 0; i < 100; i += 1) {
  const state = await call('/api/branch-studio/state?sessionId=session-m')
  group = state.groups.find(item => item.id === created.group.id)
  if (group && (group.branches[0].status === 'completed' || group.branches[0].status === 'error')) break
  await new Promise(resolve => setTimeout(resolve, 30))
}
assert(group?.branches?.[0]?.status === 'completed', `confirmed branch completed: ${group?.branches?.[0]?.status} ${group?.branches?.[0]?.error}`)

const after = readState()
assert(after.groups.length === 1, `state retained only the newest group (has ${after.groups.length})`)
assert(after.groups[0].id === created.group.id, 'retained group is the new one')
assert(!existsSync(join(studio, 'g_old')), 'pruned group workspace removed')

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(workspace, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('maintenance smoke: OK')
