/**
 * Host smoke test: run the plugin's apply() against a fake Cordis context,
 * exercise create/run/diff/promote/rollback against a temporary non-git
 * workspace, and assert the files come out the way the UI expects.
 *
 *   node test/host-smoke.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateHome = mkdtempSync(join(tmpdir(), 'branch-studio-home-'))
process.env.DSH_HOME = stateHome

const { apply } = await import('../index.js')

const cleanups = []
const tools = new Map()
const routes = new Map()

function fakeCtx() {
  return {
    logger: () => ({ info() {} }),
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    tools: { register: (definition) => { tools.set(definition.name, definition) } },
    connection: { fetch: { register: (definition) => { routes.set(definition.path, definition) } } },
    agents: {
      get: (id) => (id === 'session-1' ? agent : undefined),
    },
    subagents: {
      startActivation: async (spec) => {
        lastSpecs.push(spec)
        // Simulate the branch agent editing its isolated workspace.
        try {
          writeFileSync(join(spec.cwd, 'src', 'app.txt'), 'line one\nline two\nline three\n', 'utf8')
        } catch {
          // a missing fixture is reported by the assertions below
        }
        return {
          childId: `child-${lastSpecs.length}`,
          result: Promise.resolve({
            output: [{ type: 'text', text: '# Branch answer\nchanged the thing' }],
            stopReason: 'completed',
          }),
          dispose: async () => {},
        }
      },
      interrupt: () => {},
    },
    sessions: {
      get: () => ({}),
    },
    sessionProjections: { snapshot: () => ({ values: {} }) },
    workingDirectory: { get: () => agent.session.header.cwd },
    tokenMeter: { measure: () => ({ totalTokens: 4321 }) },
  }
}

const agent = {
  id: 'session-1',
  session: { header: { id: 'session-1', cwd: '' } },
  model: { current: () => ({ provider: 'demo', model: 'demo-1' }) },
  inject: () => {},
}
const lastSpecs = []

function request(url, body) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    async json() {
      if (body === undefined) throw new Error('no body')
      return body
    },
  }
}

async function callRoute(path, body) {
  const definition = routes.get(path.split('?')[0])
  if (!definition) throw new Error(`route missing: ${path}`)
  const response = await definition.fetch(request(`http://local${path}`, body))
  const payload = await response.json()
  if (payload.ok !== true) throw new Error(`${path}: ${payload.error?.message}`)
  return payload
}

async function waitFor(predicate, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const state = await callRoute('/api/branch-studio/state?sessionId=session-1')
    const group = state.groups[0]
    if (group && predicate(group)) return group
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('timed out waiting for branches')
}

function assert(condition, message) {
  if (!condition) throw new Error(`assert failed: ${message}`)
}

const workspace = mkdtempSync(join(tmpdir(), 'branch-studio-'))
mkdirSync(join(workspace, 'src'), { recursive: true })
writeFileSync(join(workspace, 'src', 'app.txt'), 'line one\nline two\n', 'utf8')
writeFileSync(join(workspace, 'README.md'), '# Demo\n', 'utf8')

agent.session.header.cwd = workspace

const ctx = fakeCtx()
apply(ctx, { maxCopyMB: 200, maxCopyFiles: 10000 })

// 1. Create a group with two branches (flat model fields like the UI sends).
const created = await callRoute('/api/branch-studio/create', {
  sessionId: 'session-1',
  goal: 'make the demo better',
  title: 'demo run',
  inherit: true,
  maxTokens: 100000,
  branches: [
    { label: 'A', angle: 'small change' },
    { label: 'B', angle: 'rewrite', provider: 'demo', model: 'demo-2' },
  ],
})
assert(created.group.branches.length === 2, 'two branches created')
assert(created.group.mode === 'copy', 'non-git workspace uses copy mode')

const finished = await waitFor(group => group.branches.every(branch => branch.status === 'completed' || branch.status === 'error'))
assert(finished.branches.every(branch => branch.status === 'completed'), `both branches completed: ${JSON.stringify(finished.branches.map(b => b.status))}`)
assert(finished.branches[1].model?.model === 'demo-2', 'per-branch model recorded')
assert(finished.branches[0].tokens === 4321, 'tokens captured')
assert(finished.branches[0].answer.includes('Branch answer'), 'answer captured')
assert(finished.branches[0].stat.includes('src/app.txt'), `copy diff lists the file: ${finished.branches[0].stat}`)

// 2. The branch edit is already in its isolated workspace; promote it and check
//    the real file changes.
const promoted = await callRoute('/api/branch-studio/promote', { sessionId: 'session-1', branch: finished.branches[0].id, verifyAfter: true })
assert(promoted.result.ok === true, `promotion ok: ${promoted.result.message}`)
assert(readFileSync(join(workspace, 'src', 'app.txt'), 'utf8').includes('line three'), 'promoted file content')

// 3. A group whose verification fails must roll the promotion back.
const created2 = await callRoute('/api/branch-studio/create', {
  sessionId: 'session-1',
  goal: 'second run',
  verify: 'node -e "process.exit(1)"',
  branches: [{ label: 'C', angle: 'change' }],
})
const finished2 = await waitFor(group => group.id === created2.group.id && group.branches.every(branch => branch.status === 'completed' || branch.status === 'error'))
const branchDir2 = finished2.branches[0].workspace
writeFileSync(join(branchDir2, 'src', 'app.txt'), 'rolled back content\n', 'utf8')
const before = readFileSync(join(workspace, 'src', 'app.txt'), 'utf8')
const rolled = await callRoute('/api/branch-studio/promote', { sessionId: 'session-1', branch: finished2.branches[0].id, verifyAfter: true })
assert(rolled.result.rolledBack === true, `verification failure rolls back: ${JSON.stringify(rolled.result)}`)
assert(readFileSync(join(workspace, 'src', 'app.txt'), 'utf8') === before, 'workspace restored after rollback')

// 4. Tools are registered.
assert(tools.has('branch_start'), 'branch_start tool')
assert(tools.has('branch_compare'), 'branch_compare tool')
assert(tools.has('branch_promote'), 'branch_promote tool')

// 5. Archive removes the group and its workspaces.
await callRoute('/api/branch-studio/archive', { sessionId: 'session-1', group: finished2.id })
const after = await callRoute('/api/branch-studio/state?sessionId=session-1')
assert(!after.groups.some(group => group.id === finished2.id), 'group archived')

for (const dispose of cleanups) {
  try {
    dispose()
  } catch {
    // ignore
  }
}
rmSync(workspace, { recursive: true, force: true })
rmSync(stateHome, { recursive: true, force: true })
console.log('host smoke: OK')
