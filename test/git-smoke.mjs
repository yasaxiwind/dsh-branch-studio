/**
 * Git-mode smoke test: a failing post-promotion verification must reverse the
 * applied patch and leave the repository exactly as it was.
 *
 *   node test/git-smoke.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-studio-git-home-'))
process.env.DSH_HOME = stateHome
const { apply } = await import('../index.js')

const repo = mkdtempSync(join(tmpdir(), 'branch-studio-git-'))
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 't@t')
git('config', 'user.name', 't')
writeFileSync(join(repo, 'hello.txt'), 'hello\n', 'utf8')
writeFileSync(join(repo, 'verify.mjs'), 'process.exit(1)\n', 'utf8')
git('add', '-A')
git('commit', '-qm', 'init')
const before = readFileSync(join(repo, 'hello.txt'), 'utf8')

const routes = new Map()
const tools = new Map()
const cleanups = []
const lastSpecs = []
const agent = {
  id: 'session-git',
  session: { header: { id: 'session-git', cwd: repo } },
  model: { current: () => ({ provider: 'demo', model: 'demo' }) },
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
  agents: { get: id => (id === 'session-git' ? agent : undefined) },
  subagents: {
    startActivation: async spec => {
      lastSpecs.push(spec)
      writeFileSync(join(spec.cwd, 'hello.txt'), 'hello world\n', 'utf8')
      return {
        childId: `child-${lastSpecs.length}`,
        result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
    interrupt: () => {},
  },
  sessions: { get: () => ({}) },
  sessionProjections: { snapshot: () => ({ values: {} }) },
  workingDirectory: { get: () => repo },
  tokenMeter: { measure: () => ({ totalTokens: 123 }) },
}

apply(ctx, { maxCopyMB: 10 })

const call = async (path, body) => {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`missing route ${path}`)
  const request = {
    url: `http://local${path}`,
    async json() { return body },
  }
  const payload = await (await definition.fetch(request)).json()
  if (payload.ok !== true) throw new Error(payload.error?.message ?? 'route failed')
  return payload
}
const assert = (ok, message) => { if (!ok) throw new Error(`assert: ${message}`) }

const created = await call('/api/branch-studio/create', {
  sessionId: 'session-git',
  goal: 'change hello',
  verify: 'node verify.mjs',
  branches: [{ label: 'A', angle: 'change it' }],
})
assert(created.group.mode === 'git', 'git mode selected')

let group
for (let i = 0; i < 100; i += 1) {
  const state = await call('/api/branch-studio/state?sessionId=session-git')
  group = state.groups[0]
  if (group && group.branches.every(branch => branch.status === 'completed' || branch.status === 'error')) break
  await new Promise(resolve => setTimeout(resolve, 100))
}
assert(group?.branches?.[0]?.status === 'completed', 'branch completed')
assert(!JSON.stringify(group.branches[0].files).includes('changes.patch'), 'no plugin metadata in the branch diff')

const promoted = await call('/api/branch-studio/promote', { sessionId: 'session-git', branch: group.branches[0].id, verifyAfter: true })
assert(promoted.result.rolledBack === true, `rolled back: ${JSON.stringify(promoted.result)}`)
assert(promoted.result.verify?.ok === false, 'verification failed as configured')
assert(readFileSync(join(repo, 'hello.txt'), 'utf8') === before, 'hello.txt restored')
assert(git('status', '--porcelain').trim() === '', 'repository clean after rollback')

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}
rmSync(repo, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('git smoke: OK')
