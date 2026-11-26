/**
 * Branch studio - Host half.
 *
 * Fans a session out into several isolated "branches": each branch is a child
 * agent started from the current conversation (fork) or from a clean context
 * (spawn), running inside its own workspace copy (non-git) or git worktree
 * (git). Their answers, file changes, verification results, tokens and wall
 * time are collected so they can be compared and one of them promoted back
 * into the real workspace.
 *
 * Model-facing tools: branch_start / branch_list / branch_compare /
 * branch_promote / branch_archive.
 * Client routes: /api/branch-studio/*.
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { cp as cpAsync } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const name = 'branch-studio'
export const inject = ['tools', 'connection', 'subagents', 'agents', 'sessions', 'tokenMeter', 'sessionProjections', 'workingDirectory']

const DEFAULTS = {
  maxBranches: 4,
  maxCopyMB: 1536,
  maxCopyFiles: 60000,
  copyWarnMB: 300,
  copyPollMs: 1000,
  keepGroups: 50,
  keepDays: 14,
  sweepGraceMs: 3600000,
  linkDeps: true,
  verifyTimeoutMs: 180000,
  answerChars: 20000,
  patchBytes: 2 * 1024 * 1024,
  maxTokensPerBranch: 0,
  budgetPollMs: 5000,
  capacityWaitMs: 300000,
  capacityRetryMs: 3000,
}

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', '.dsh-branch-studio', 'node_modules', '__pycache__',
  '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.next',
  '.nuxt', '.cache', '.turbo', 'dist', 'build', 'out', 'target', 'coverage',
])

const STUDIO_DIR = '.dsh-branch-studio'

/**
 * Whether a path resolves inside a root directory.
 * @param {string} root - trusted root.
 * @param {string} target - candidate path.
 * @returns {boolean} true when target is the root or below it.
 */
function inside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Local tool-definition helper. Bare `@deepseek-ai/*` specifiers do not resolve
 * from a linked workspace plugin, so the registry-ready shape is produced here.
 * @param {object} options - tool definition fields.
 * @returns {object} registry-ready definition.
 */
function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: options.output,
    async execute(args, exec) {
      return await options.execute(args, exec)
    },
  }
}

/** @returns {string} the DSH home directory. */
function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

/** @returns {string} the persisted state file. */
function statePath() {
  return join(dshHome(), 'branch-studio', 'state.json')
}

/** @returns {object} an empty state. */
function emptyState() {
  return { version: 1, groups: [], roots: [] }
}

/**
 * Read persisted state, tolerating a missing or broken file. Branches that were
 * live when the host stopped can never settle, so they become interrupted.
 * @returns {object} state.
 */
function loadState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (raw && Array.isArray(raw.groups)) {
      const groups = raw.groups.map(group => ({
        ...group,
        branches: (group.branches ?? []).map(branch => {
          if (branch.status !== 'preparing' && branch.status !== 'queued' && branch.status !== 'running') return branch
          return {
            ...branch,
            status: 'interrupted',
            error: branch.error || 'the host restarted while this branch was running',
            endedAt: branch.endedAt ?? Date.now(),
            progress: null,
          }
        }),
      }))
      return { version: 1, groups, roots: Array.isArray(raw.roots) ? raw.roots : [] }
    }
  } catch {
    // first run, or a broken file: start clean and let the next write replace it.
  }
  return emptyState()
}

/**
 * Persist state atomically.
 * @param {object} state - state to write.
 * @returns {void}
 */
function saveState(state) {
  const file = statePath()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  // Manifests (tens of thousands of file records) are per-branch caches kept in
  // their own JSON files; persisting them inside state.json would bloat every
  // write and every client poll.
  const groups = state.groups.map(group => {
    const { manifest, ...rest } = group
    return {
      ...rest,
      branches: (rest.branches ?? []).map(branch => {
        const { baseManifest, ...branchRest } = branch
        return branchRest
      }),
    }
  })
  writeFileSync(temp, `${JSON.stringify({ version: 1, roots: state.roots ?? [], groups }, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

/**
 * Run a command and capture its output.
 * @param {string} command - executable.
 * @param {string[]} args - arguments.
 * @param {object} [options] - spawn options.
 * @returns {{status:number|null, stdout:string, stderr:string, error:Error|null}} result.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 60000,
    cwd: options.cwd,
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  }
}

/**
 * Run one git command.
 * @param {string} cwd - working directory.
 * @param {string[]} args - git arguments.
 * @param {object} [options] - run options.
 * @returns {{status:number|null, stdout:string, stderr:string, error:Error|null}} result.
 */
function git(cwd, args, options = {}) {
  return run('git', ['-C', cwd, ...args], options)
}

/**
 * Detect whether a directory is a git worktree with a commit.
 * @param {string} cwd - directory to inspect.
 * @returns {{repo:string, head:string}|null} repository facts.
 */
function detectGit(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return null
  const repo = top.stdout.trim()
  if (!repo) return null
  const head = git(repo, ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) return null
  return { repo, head: head.stdout.trim() }
}

/**
 * Ensure the studio directory is ignored by git in a repository.
 * @param {string} repo - repository root.
 * @returns {void}
 */
function excludeStudioDir(repo) {
  try {
    const common = git(repo, ['rev-parse', '--git-common-dir'])
    const dir = common.status === 0 ? resolve(repo, common.stdout.trim()) : join(repo, '.git')
    const file = join(dir, 'info', 'exclude')
    mkdirSync(dirname(file), { recursive: true })
    const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (!current.split(/\r?\n/).some(line => line.trim() === `${STUDIO_DIR}/`)) {
      writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${STUDIO_DIR}/\n`, 'utf8')
    }
  } catch {
    // Ignoring the studio directory is a convenience, never a requirement.
  }
}

/**
 * Walk a directory tree without following links.
 * @param {string} root - absolute root.
 * @param {object} [options] - caps and skip set.
 * @returns {{files:Array<{rel:string, size:number, mtime:number}>, bytes:number, truncated:boolean}} listing.
 */
function walkTree(root, options = {}) {
  const files = []
  let bytes = 0
  let truncated = false
  const maxFiles = options.maxFiles ?? 200000
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= maxFiles) {
        truncated = true
        return { files, bytes, truncated }
      }
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      files.push({ rel: relative(root, full).split(sep).join('/'), size: info.size, mtime: info.mtimeMs })
      bytes += info.size
    }
  }
  return { files, bytes, truncated }
}

/**
 * Measure a directory tree without following links, for progress reporting.
 * @param {string} root - absolute root.
 * @param {number} [maxFiles] - stop after this many files.
 * @returns {{bytes:number, files:number, truncated:boolean}} size facts.
 */
function measureTree(root, maxFiles = 200000) {
  let bytes = 0
  let files = 0
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files >= maxFiles) return { bytes, files, truncated: true }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      try {
        bytes += statSync(join(dir, entry.name)).size
        files += 1
      } catch {
        // a file that vanished mid-walk does not count
      }
    }
  }
  return { bytes, files, truncated: false }
}

/**
 * Copy a directory tree asynchronously: robocopy on Windows, fs.cp elsewhere.
 * Asynchronous so the host can report copy progress while a large workspace is
 * being duplicated.
 * @param {string} source - source root.
 * @param {string} target - target root (created).
 * @returns {Promise<void>} completion.
 */
async function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  if (process.platform === 'win32') {
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('robocopy', [
        source,
        target,
        '/E',
        '/COPY:DAT',
        '/XD', ...SKIP_DIRS,
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
        '/R:1', '/W:1',
        '/MT:8',
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        rejectPromise(new Error('copy timed out after 10 minutes'))
      }, 600000)
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', error => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      child.on('close', code => {
        clearTimeout(timer)
        // Robocopy reports 0-7 for success and 8+ for a real failure.
        if (code === null || code >= 8) {
          rejectPromise(new Error(`copy failed (robocopy exit ${code}): ${stderr.slice(-400)}`))
        } else {
          resolvePromise()
        }
      })
    })
    return
  }
  // Non-Windows: copy entry by entry, because the destination lives inside the
  // source tree (the studio directory) and a single recursive copy of the root
  // into its own descendant is rejected.
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    await cpAsync(join(source, entry.name), join(target, entry.name), {
      recursive: true,
      preserveTimestamps: true,
      dereference: false,
      filter: src => !relative(source, src).split(sep).some(part => SKIP_DIRS.has(part)),
    })
  }
}

/**
 * @param {string} root - absolute root.
 * @returns {object} manifest payload.
 */
function buildManifest(root) {
  const listing = walkTree(root, { maxFiles: 200000 })
  const files = {}
  for (const file of listing.files) files[file.rel] = { s: file.size, m: Math.round(file.mtime) }
  return { root, createdAt: Date.now(), files, bytes: listing.bytes, truncated: listing.truncated }
}

/**
 * Compare a branch tree with its base manifest.
 * @param {string} root - branch root.
 * @param {object} manifest - base manifest.
 * @returns {{files:Array<{path:string,status:string}>, added:number, modified:number, deleted:number}} changes.
 */
function compareTree(root, manifest) {
  const listing = walkTree(root, { maxFiles: 200000 })
  const seen = new Set()
  const files = []
  for (const file of listing.files) {
    seen.add(file.rel)
    const base = manifest.files[file.rel]
    if (!base) {
      files.push({ path: file.rel, status: 'added' })
    } else if (base.s !== file.size || Math.abs(base.m - Math.round(file.mtime)) > 2000) {
      files.push({ path: file.rel, status: 'modified' })
    }
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!seen.has(rel)) files.push({ path: rel, status: 'deleted' })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return {
    files,
    added: files.filter(file => file.status === 'added').length,
    modified: files.filter(file => file.status === 'modified').length,
    deleted: files.filter(file => file.status === 'deleted').length,
  }
}

/**
 * Render a bounded unified diff for one changed text file using git.
 * @param {string} baseRoot - base tree root.
 * @param {string} branchRoot - branch tree root.
 * @param {string} rel - relative path.
 * @param {number} maxBytes - cap.
 * @returns {string} diff text (empty when unavailable).
 */
function diffOneFile(baseRoot, branchRoot, rel, maxBytes) {
  const base = join(baseRoot, rel)
  const branch = join(branchRoot, rel)
  if (!existsSync(branch)) return ''
  if (existsSync(base)) {
    const result = run('git', [
      'diff', '--no-index', '--no-color', '--unified=2', '--',
      base, branch,
    ], { timeout: 20000 })
    const text = `${result.stdout}\n${result.stderr}`.trim()
    return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n... (diff truncated)` : text
  }
  // Added file: show a short preview rather than a /dev/null diff, which git
  // handles inconsistently across platforms.
  try {
    const content = readFileSync(branch)
    if (content.includes(0)) return `new binary file: ${rel}`
    const text = content.toString('utf8')
    const lines = text.split(/\r?\n/).slice(0, 80).map(line => `+${line}`).join('\n')
    return `--- /dev/null\n+++ ${rel}\n${lines}${text.split(/\r?\n/).length > 80 ? '\n...' : ''}`
  } catch {
    return `new file: ${rel}`
  }
}

/**
 * Parse `git status --porcelain` into change rows.
 * @param {string} text - porcelain output.
 * @returns {Array<{path:string,status:string}>} rows.
 */
function parsePorcelain(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3).trim()
    if (path.includes(' -> ')) path = path.split(' -> ').pop()
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\"/g, '"')
    const status = code.includes('A') || code === '??'
      ? 'added'
      : code.includes('D')
        ? 'deleted'
        : 'modified'
    rows.push({ path: path.split(sep).join('/'), status })
  }
  return rows
}

/**
 * Extract text from model content blocks.
 * @param {Array} blocks - content blocks.
 * @returns {string} joined text.
 */
function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * Create a short random id.
 * @param {string} prefix - id prefix.
 * @returns {string} id.
 */
function shortId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * ISO timestamp for display.
 * @param {number} value - epoch ms.
 * @returns {string} iso string.
 */
function iso(value) {
  return value ? new Date(value).toISOString() : null
}

/**
 * Host plugin entry.
 * @param {object} ctx - Cordis host context.
 * @param {object} config - bundle config.
 * @returns {void}
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  const state = loadState()
  /** @type {Map<string, {group:object, branch:object, activation:object, controller:AbortController}>} */
  const running = new Map()

  const log = line => {
    try {
      if (typeof ctx.logger === 'function') ctx.logger('branch-studio').info(line)
    } catch {
      // logging must never break a run
    }
  }

  // A previous Host may have died while a branch was running; nothing can
  // settle those activations now, so mark them instead of pretending.
  for (const group of state.groups) {
    for (const branch of group.branches ?? []) {
      if (branch.status === 'preparing' || branch.status === 'running' || branch.status === 'queued') {
        branch.status = 'interrupted'
        branch.error = 'The Host restarted before this branch settled.'
        branch.endedAt = branch.endedAt ?? Date.now()
        branch.progress = null
      }
    }
  }
  try {
    sweepStudio()
    saveState(state)
  } catch {
    // cleanup is best effort; never block startup
  }

  /**
   * Find one group.
   * @param {string} id - group id.
   * @returns {object|undefined} group.
   */
  const groupOf = id => state.groups.find(group => group.id === id)

  /**
   * Find one branch and its group.
   * @param {string} id - branch id.
   * @returns {{group:object, branch:object}|undefined} pair.
   */
  const branchOf = (id, sessionId) => {
    for (const group of state.groups) {
      if (sessionId !== undefined && group.sessionId !== sessionId) continue
      const branch = (group.branches ?? []).find(item => item.id === id)
      if (branch) return { group, branch }
    }
    return undefined
  }

  /**
   * Branch tools are for the top-level conversation only. A branch child is a
   * subagent; letting it promote its own work would bypass the human's choice.
   * @param {object} exec - tool execution context.
   * @returns {string} caller session id.
   */
  const assertTopLevel = exec => {
    const header = exec?.agent?.session?.header
    if (!header?.id) throw new Error('branch tools need a live session')
    if (header.parentSession) throw new Error('branch tools are only available to the top-level conversation, not to a subagent')
    return header.id
  }

  /**
   * Public branch row for the client.
   * @param {object} group - owning group.
   * @param {object} branch - stored branch.
   * @returns {object} row.
   */
  const branchRow = (group, branch) => ({
    id: branch.id,
    label: branch.label,
    angle: branch.angle ?? '',
    model: branch.model ?? null,
    provider: branch.providerName ?? null,
    inherit: branch.inherit !== false,
    status: branch.status,
    startedAt: iso(branch.startedAt),
    endedAt: iso(branch.endedAt),
    durationMs: branch.durationMs ?? null,
    tokens: branch.tokens ?? null,
    answer: branch.answer ?? '',
    error: branch.error ?? '',
    diagnostic: branch.diagnostic ?? '',
    stopReason: branch.stopReason ?? null,
    files: branch.files ?? [],
    stat: branch.stat ?? '',
    patchPath: branch.patchPath ?? null,
    verify: branch.verify ?? null,
    promotedAt: iso(branch.promotedAt),
    workspace: branch.workspace ?? null,
    progress: branch.progress ?? null,
    childId: branch.childId ?? null,
    warning: branch.warning ?? '',
    maxTokens: branch.maxTokens ?? null,
    budgetExceeded: branch.budgetExceeded === true,
    groupId: group.id,
  })

  /**
   * Public group row for the client.
   * @param {object} group - stored group.
   * @returns {object} row.
   */
  const groupRow = group => ({
    id: group.id,
    title: group.title,
    goal: group.goal,
    cwd: group.cwd,
    mode: group.mode,
    repo: group.repo ?? null,
    inherit: group.inherit !== false,
    verify: group.verify ?? '',
    maxTokens: group.maxTokens ?? 0,
    createdAt: iso(group.createdAt),
    studioRoot: group.studioRoot,
    branches: (group.branches ?? []).map(branch => branchRow(group, branch)),
  })

  /**
   * Groups visible to one session, newest first.
   * @param {string|null} sessionId - session filter.
   * @returns {object[]} rows.
   */
  function groupsFor(sessionId) {
    return state.groups
      .filter(group => !sessionId || group.sessionId === sessionId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(groupRow)
  }

  /**
   * Billed tokens for a child session, from provider-reported usage when
   * available. Falls back to the context-pressure estimate.
   * @param {string} sessionId - child session id.
   * @returns {number|null} tokens.
   */
  function tokensOf(sessionId) {
    let session
    try {
      session = ctx.sessions.get(sessionId)
    } catch {
      return null
    }
    if (!session) return null
    try {
      const snapshot = ctx.sessionProjections.snapshot(session)
      const usage = snapshot?.values?.tokenUsage
      if (usage) {
        return (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
      }
    } catch {
      // fall through to the context-pressure estimate
    }
    try {
      const measured = ctx.tokenMeter.measure(session)
      return measured?.totalTokens ?? null
    } catch {
      return null
    }
  }

  /**
   * The session's current working directory, following `cd` changes.
   * @param {object} agent - live agent.
   * @returns {string} absolute directory.
   */
  function cwdOf(agent) {
    try {
      const current = ctx.workingDirectory.get(agent.session)
      if (typeof current === 'string' && current !== '') return current
    } catch {
      // fall through to the immutable header
    }
    return agent.session?.header?.cwd ?? process.cwd()
  }

  /**
   * Compose the branch prompt. Fork children inherit the conversation; spawn
   * children do not, so their prompt carries the goal explicitly.
   * @param {object} group - owning group.
   * @param {object} spec - requested branch.
   * @returns {string} prompt text.
   */
  function composePrompt(group, spec) {
    const angle = (spec.angle ?? '').trim()
    const goal = (group.goal ?? '').trim()
    const lines = []
    if (group.inherit === false) {
      lines.push('You are an independent branch of a parallel exploration. You do not see the original conversation; this brief is self-contained.')
      lines.push(`Task: ${goal || '(not provided)'}`)
    } else {
      lines.push('You are one branch of a parallel exploration started from the conversation above.')
      lines.push(`The user's goal: ${goal || '(continue the conversation)'}`)
    }
    if (angle) lines.push(`Your angle, which the other branch does not have: ${angle}`)
    lines.push(`Your workspace is ${spec.workspace}. Work only inside it. Other branches are editing their own copies; do not touch them.`)
    lines.push('You are a leaf worker: do not start further branches, do not call branch_start/branch_compare/branch_promote, and do not ask the user which branch to keep.')
    lines.push('Work independently and finish the task. Do not ask clarifying questions; state assumptions in your final answer.')
    lines.push('In your final answer, list the files you changed, what you changed, why, and any command you ran to verify the result.')
    return lines.join('\n')
  }

  /**
   * Link expensive shared dependency directories (node_modules, virtualenvs)
   * into a branch so its verification command can run without a fresh install.
   * @param {string} base - directory that owns the dependency directories.
   * @param {string} target - branch workspace root.
   * @returns {string[]} names that were linked.
   */
  function linkSharedDeps(base, target) {
    if (cfg.linkDeps === false) return []
    const linked = []
    for (const name of ['node_modules', '.venv', 'venv']) {
      const from = join(base, name)
      const to = join(target, name)
      if (!existsSync(from) || existsSync(to)) continue
      try {
        if (process.platform === 'win32') {
          const result = run('cmd.exe', ['/d', '/s', '/c', `mklink /J "${to}" "${from}"`])
          if (result.status === 0) linked.push(name)
        } else {
          symlinkSync(from, to, 'dir')
          linked.push(name)
        }
      } catch {
        // A missing link only means the verify command may need its own install.
      }
    }
    return linked
  }

  /**
   * Create a branch workspace for one branch.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @returns {{workspace:string, warning:string}} workspace facts.
   */
  async function prepareWorkspace(group, branch) {
    const root = join(group.cwd, STUDIO_DIR, group.id, branch.id)
    mkdirSync(root, { recursive: true })
    branch.progress = {
      phase: group.mode === 'git' ? 'worktree' : 'copying',
      bytes: 0,
      files: 0,
      totalBytes: group.copySize?.bytes ?? null,
      totalFiles: group.copySize?.files ?? null,
      startedAt: Date.now(),
    }
    saveState(state)
    if (group.mode === 'git') {
      const target = join(group.repo, STUDIO_DIR, group.id, branch.id)
      mkdirSync(dirname(target), { recursive: true })
      const add = git(group.repo, ['worktree', 'add', '--detach', target, 'HEAD'])
      if (add.status !== 0) {
        throw new Error(`git worktree add failed: ${(add.stderr || add.stdout).trim().slice(-500)}`)
      }
      let warning = ''
      // Bring uncommitted tracked changes along so a branch starts exactly
      // where the user is, not at the last commit. Plugin metadata lives beside
      // the worktree, never inside it.
      const metaDir = join(group.cwd, STUDIO_DIR, group.id, 'meta', branch.id)
      mkdirSync(metaDir, { recursive: true })
      const dirty = git(group.repo, ['diff', 'HEAD', '--binary'], { timeout: 120000 })
      if (dirty.status === 0 && dirty.stdout.trim() !== '') {
        const patchFile = join(metaDir, 'base.patch')
        writeFileSync(patchFile, dirty.stdout, 'utf8')
        const applied = git(target, ['apply', '--binary', '--whitespace=nowarn', patchFile])
        if (applied.status !== 0) warning = `uncommitted changes could not be applied: ${(applied.stderr || applied.stdout).trim().slice(0, 300)}`
      }
      // Untracked files are not in the diff; copy them across (bounded).
      const untracked = git(group.repo, ['ls-files', '--others', '--exclude-standard', '-z'])
      if (untracked.status === 0 && untracked.stdout) {
        let copied = 0
        let bytes = 0
        for (const rel of untracked.stdout.split('\0')) {
          if (!rel || copied >= 500 || bytes >= 100 * 1024 * 1024) continue
          const from = join(group.repo, rel)
          const to = join(target, rel)
          try {
            const info = statSync(from)
            if (!info.isFile()) continue
            mkdirSync(dirname(to), { recursive: true })
            copyFileSync(from, to)
            copied += 1
            bytes += info.size
          } catch {
            // an untracked entry that vanished is not a branch failure
          }
        }
        if (copied > 0 && !warning) warning = `${copied} untracked file(s) copied into the branch`
      }
      const childCwd = join(target, relative(group.repo, group.cwd))
      branch.worktreePath = target
      const linked = linkSharedDeps(group.cwd, target)
      if (linked.length > 0) warning = [warning, `linked ${linked.join(', ')} for verification`].filter(Boolean).join('; ')
      branch.progress = { phase: 'starting', startedAt: Date.now() }
      return { workspace: childCwd, warning }
    }

    // Non-git workspace: copy the session directory into an isolated snapshot.
    // The size gate ran once in createGroup; here we only copy and report
    // progress, because a large copy otherwise looks like a hung host.
    const totals = group.copySize ?? { bytes: 0, files: 0 }
    const poll = setInterval(() => {
      try {
        const measured = measureTree(root, Math.max(1000, (totals.files ?? 0) + 1000))
        branch.progress = { ...branch.progress, bytes: measured.bytes, files: measured.files }
        saveState(state)
      } catch {
        // progress is advisory
      }
    }, Math.max(500, Number(cfg.copyPollMs) || 1000))
    try {
      await copyTree(group.cwd, root)
    } finally {
      clearInterval(poll)
    }
    const linked = linkSharedDeps(group.cwd, root)
    // Each branch keeps its own base manifest, captured right after the copy:
    // a group-wide manifest would race with edits made while later branches are
    // still copying, and report them as branch changes.
    const manifest = buildManifest(root)
    const manifestPath = join(group.cwd, STUDIO_DIR, group.id, `${branch.id}.base.json`)
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
    branch.baseManifestPath = manifestPath
    branch.progress = { phase: 'starting', startedAt: Date.now() }
    const suffix = linked.length > 0 ? `; linked ${linked.join(', ')} for verification` : ''
    return { workspace: root, warning: `copied ${totals.files} files (${((totals.bytes ?? 0) / 1048576).toFixed(1)} MB) into the branch${suffix}` }
  }

  /**
   * Start one branch's child agent.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @returns {Promise<void>} settlement.
   */
  async function startBranch(group, branch) {
    const parent = ctx.agents.get(group.sessionId)
    if (!parent) throw new Error('the source session is no longer live')
    const controller = new AbortController()
    const budget = Number(branch.maxTokens) > 0 ? Number(branch.maxTokens) : 0
    branch.status = 'preparing'
    const spec = {
      provider: branch.inherit === false ? 'spawn' : 'fork',
      label: `${group.title} / ${branch.label}`.slice(0, 80),
      // Child names are unique among one parent's children, so two groups with
      // the same branch label must not collide: derive the name from the id.
      name: `b-${branch.id.replace(/[^a-z0-9]/g, '').slice(-8)}`,
      prompt: [{ type: 'text', text: branch.prompt }],
      parent,
      signal: controller.signal,
      delivery: 'caller',
      cwd: branch.workspace,
      ...(branch.model && branch.model.provider && branch.model.model
        ? { agentOptions: { provider: branch.model.provider, model: branch.model.model, ...(branch.model.reasoningEffort ? { reasoningEffort: branch.model.reasoningEffort } : {}) } }
        : {}),
    }
    // The subagent tree has one shared capacity (maxActiveSubagents, 8 by
    // default). A branch that cannot get a slot waits for one instead of
    // failing, because another agent may finish at any moment.
    const deadline = Date.now() + Math.max(1000, Number(cfg.capacityWaitMs) || 0)
    let activation
    for (;;) {
      try {
        activation = await ctx.subagents.startActivation(spec)
        break
      } catch (error) {
        const capacity = error !== null && typeof error === 'object' && error.code === 'ACTIVATION_LIMIT_REACHED'
        if (!capacity) throw error
        if (controller.signal.aborted) throw error
        if (Date.now() >= deadline) {
          const hint = 'No subagent slot became free. Finish or archive other agents in this conversation, or start fewer branches.'
          throw new Error(`${error instanceof Error ? error.message : String(error)} ${hint}`)
        }
        branch.status = 'queued'
        branch.progress = null
        branch.error = 'waiting for a subagent slot...'
        saveState(state)
        await new Promise(resolve => setTimeout(resolve, Math.max(200, Number(cfg.capacityRetryMs) || 3000)))
      }
    }
    branch.status = 'running'
    branch.startedAt = Date.now()
    branch.error = ''
    branch.progress = null
    branch.childId = activation.childId
    running.set(branch.id, { group, branch, activation, controller })
    saveState(state)
    // One timer both samples live token usage for the UI and enforces the
    // optional budget. A child session is gone after settlement, so the last
    // sample is also what the final row reports.
    const timer = setInterval(() => {
      try {
        const used = tokensOf(branch.childId)
        if (used !== null) branch.tokens = used
        if (budget > 0 && used !== null && used > budget && !branch.budgetExceeded) {
          branch.budgetExceeded = true
          branch.error = `branch stopped at its ${budget.toLocaleString()}-token budget (used ${used.toLocaleString()})`
          ctx.subagents.interrupt(branch.childId, { kind: 'user' })
        }
      } catch {
        // measurement is advisory; never break the run for it
      }
    }, Math.max(1500, cfg.budgetPollMs))
    running.get(branch.id).tokenTimer = timer
    activation.result.then(
      result => finalizeBranch(group, branch, result, null),
      error => finalizeBranch(group, branch, null, error),
    )
  }

  /**
   * Settle one branch: collect answer, diff, tokens and verification.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @param {object|null} result - subagent result.
   * @param {unknown} failure - rejection.
   * @returns {Promise<void>} completion.
   */
  async function finalizeBranch(group, branch, result, failure) {
    const entry = running.get(branch.id)
    if (entry?.tokenTimer) clearInterval(entry.tokenTimer)
    try {
      if (branch.budgetExceeded) {
        branch.status = 'error'
        branch.stopReason = result?.stopReason ?? branch.stopReason ?? 'aborted'
        branch.answer = textOf(result?.output).slice(0, cfg.answerChars)
      } else if (failure) {
        branch.status = 'error'
        branch.error = failure instanceof Error ? failure.message : String(failure)
      } else {
        branch.answer = textOf(result?.output).slice(0, cfg.answerChars)
        branch.stopReason = result?.stopReason ?? null
        branch.diagnostic = result?.diagnostic ? String(result.diagnostic).slice(0, 2000) : ''
        branch.status = result?.stopReason === 'completed' ? 'completed' : 'error'
        if (branch.status === 'error') branch.error = branch.diagnostic || `branch ended with ${branch.stopReason}`
      }
      branch.endedAt = Date.now()
      branch.durationMs = branch.endedAt - (branch.startedAt ?? branch.endedAt)
    if (branch.childId) {
      // The caller-delivery child may already be torn down here, so the last
      // sample taken while it ran is the authoritative fallback.
      try {
        const final = tokensOf(branch.childId)
        if (final !== null) branch.tokens = final
      } catch {
        // keep the last sampled value
      }
    }
      try {
        Object.assign(branch, diffOf(group, branch))
      } catch (error) {
        branch.warning = [branch.warning, `diff failed: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join('; ')
      }
      if (group.verify && branch.status !== 'interrupted') {
        branch.verify = runVerify(group, branch)
      }
      log(`branch ${branch.id} settled as ${branch.status}`)
    } finally {
      running.delete(branch.id)
      saveState(state)
    }
  }

  /**
   * Compute the branch's file changes and patch.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @returns {{files:Array, stat:string, patchPath:string|null, patchText:string}} diff facts.
   */
  function diffOf(group, branch) {
    if (!branch.workspace || !existsSync(branch.workspace)) {
      return { files: [], stat: 'workspace removed', patchPath: null, patchText: '' }
    }
    const metaDir = join(group.cwd, STUDIO_DIR, group.id, 'meta', branch.id)
    mkdirSync(metaDir, { recursive: true })
    const patchPath = join(metaDir, 'changes.patch')

    if (group.mode === 'git') {
      git(branch.workspace, ['add', '-A'])
      const stat = git(branch.workspace, ['diff', '--cached', '--stat', 'HEAD'])
      const patch = git(branch.workspace, ['diff', '--cached', '--binary', 'HEAD'], { timeout: 120000 })
      let text = patch.stdout
      if (text.length > cfg.patchBytes) text = `${text.slice(0, cfg.patchBytes)}\n... (patch truncated)`
      writeFileSync(patchPath, text, 'utf8')
      const status = git(branch.workspace, ['status', '--porcelain'])
      return {
        files: parsePorcelain(status.stdout),
        stat: stat.stdout.trim(),
        patchPath,
        patchText: text,
      }
    }

    const manifest = readBranchManifest(group, branch)
    const changes = compareTree(branch.workspace, manifest)
    const parts = []
    for (const file of changes.files) {
      if (parts.length >= 25) {
        parts.push('... (more changed files omitted)')
        break
      }
      if (file.status === 'deleted') {
        parts.push(`deleted: ${file.path}`)
        continue
      }
      const piece = diffOneFile(group.cwd, branch.workspace, file.path, 60000)
      if (piece) parts.push(piece)
    }
    let text = parts.join('\n\n')
    if (text.length > cfg.patchBytes) text = `${text.slice(0, cfg.patchBytes)}\n... (diff truncated)`
    writeFileSync(patchPath, text, 'utf8')
    const summary = `${changes.added} added, ${changes.modified} modified, ${changes.deleted} deleted`
    const listed = changes.files.slice(0, 12).map(file => `\n${file.status}: ${file.path}`).join('')
    const more = changes.files.length > 12 ? `\n... ${changes.files.length - 12} more` : ''
    return {
      files: changes.files,
      stat: `${summary}${listed}${more}`,
      patchPath,
      patchText: text,
    }
  }

  /**
   * Read (or build) one branch's base manifest for non-git workspaces.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @returns {object} manifest.
   */
  function readBranchManifest(group, branch) {
    if (branch.baseManifest && branch.baseManifest.files) return branch.baseManifest
    const path = branch.baseManifestPath
      ?? join(group.cwd, STUDIO_DIR, group.id, `${branch.id}.base.json`)
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (value && value.files) {
        branch.baseManifest = value
        branch.baseManifestPath = path
        return value
      }
    } catch {
      // fall through to a best-effort rebuild from the branch copy
    }
    const manifest = buildManifest(branch.workspace)
    branch.baseManifest = manifest
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(manifest), 'utf8')
      branch.baseManifestPath = path
    } catch {
      // the manifest is advisory; a missing file only weakens conflict checks
    }
    return manifest
  }

  /**
   * Run a verification command inside a directory.
   * @param {string} cwd - directory to run in.
   * @param {string} command - shell command.
   * @returns {object} verification result.
   */
  function runVerifyIn(cwd, command) {
    let result
    if (process.platform === 'win32') {
      // cmd.exe mangles inline quoting for commands like `node -e "..."`, so
      // the command is staged in a .cmd file under DSH_HOME (a space-free path
      // in the normal case) and that file is executed.
      const dir = join(dshHome(), 'branch-studio', '.verify')
      const file = join(dir, `verify-${process.pid}-${Date.now()}.cmd`)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, `@echo off\r\n${command}\r\n`, 'utf8')
        result = run('cmd.exe', ['/d', '/s', '/c', file], { cwd, timeout: cfg.verifyTimeoutMs })
      } finally {
        try {
          rmSync(file, { force: true })
        } catch {
          // ignore
        }
      }
    } else {
      result = run('sh', ['-c', command], { cwd, timeout: cfg.verifyTimeoutMs })
    }
    const output = `${result.stdout}\n${result.stderr}`.trim()
    return {
      command,
      code: result.status,
      ok: result.status === 0,
      output: output.slice(-4000),
      at: Date.now(),
    }
  }

  /**
   * Run the group's verification command inside one branch workspace.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @returns {object} verification result.
   */
  function runVerify(group, branch) {
    if (!group.verify) return null
    return runVerifyIn(branch.workspace, String(group.verify))
  }

  /**
   * Promote one branch into the real workspace.
   * @param {object} group - owning group.
   * @param {object} branch - branch record.
   * @param {object} options - promotion options.
   * @returns {object} result.
   */
  function promote(group, branch, options = {}) {
    if (!branch.workspace || !existsSync(branch.workspace)) throw new Error('the branch workspace is gone')
    if (branch.status !== 'completed') throw new Error(`only a completed branch can be promoted (this one is ${branch.status})`)
    const verifyAfter = options.verifyAfter !== false && Boolean(group.verify)

    if (group.mode === 'git') {
      git(branch.workspace, ['add', '-A'])
      const patch = git(branch.workspace, ['diff', '--cached', '--binary', 'HEAD'], { timeout: 120000 })
      if (patch.status !== 0) throw new Error(`could not read the branch patch: ${(patch.stderr || patch.stdout).trim()}`)
      if (!patch.stdout.trim()) return { ok: true, mode: 'git', applied: [], conflicts: [], empty: true, message: 'This branch made no file changes.' }
      const patchFile = join(group.cwd, STUDIO_DIR, group.id, 'meta', branch.id, 'promote.patch')
      mkdirSync(dirname(patchFile), { recursive: true })
      writeFileSync(patchFile, patch.stdout, 'utf8')
      const check = git(group.repo, ['apply', '--check', patchFile])
      if (check.status !== 0) {
        return {
          ok: false,
          mode: 'git',
          applied: [],
          conflicts: [{ path: '(patch)', reason: (check.stderr || check.stdout).trim().slice(0, 2000) }],
          message: 'The workspace changed since this branch started; the patch does not apply cleanly. Review the diff and apply it by hand, or start a fresh branch.',
        }
      }
      // Back up exactly the files the patch touches, so a failed post-apply
      // verification restores their bytes instead of relying on a reverse patch
      // (which can normalise line endings on Windows).
      const rollbackDir = join(group.cwd, STUDIO_DIR, group.id, 'meta', branch.id, 'rollback', 'files')
      const backups = []
      const names = git(branch.workspace, ['diff', '--cached', '--name-status', 'HEAD'])
      for (const line of names.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue
        const [code, ...rest] = line.split('\t')
        const rel = rest[rest.length - 1]
        if (!rel) continue
        if (code.startsWith('A')) {
          backups.push({ path: rel, existed: false })
          continue
        }
        try {
          const backup = join(rollbackDir, rel)
          mkdirSync(dirname(backup), { recursive: true })
          copyFileSync(resolve(group.repo, rel), backup)
          backups.push({ path: rel, existed: true })
        } catch {
          backups.push({ path: rel, existed: true, failed: true })
        }
      }
      const applied = git(group.repo, ['apply', patchFile])
      if (applied.status !== 0) throw new Error(`git apply failed: ${(applied.stderr || applied.stdout).trim()}`)
      const status = git(group.repo, ['status', '--porcelain'])
      // Promotion is only final after the real workspace still verifies.
      let verify = null
      if (verifyAfter) {
        verify = runVerifyIn(group.repo, String(group.verify))
        if (!verify.ok) {
          let rolledBack = true
          for (const item of backups.slice().reverse()) {
            try {
              const target = resolve(group.repo, item.path)
              if (item.existed) copyFileSync(join(rollbackDir, item.path), target)
              else rmSync(target, { force: true })
            } catch {
              rolledBack = false
            }
          }
          if (!rolledBack) {
            const revert = git(group.repo, ['apply', '-R', patchFile])
            rolledBack = revert.status === 0
          }
          return {
            ok: false,
            mode: 'git',
            applied: parsePorcelain(status.stdout),
            conflicts: [],
            verify,
            rolledBack,
            message: rolledBack
              ? 'The branch applied, but verification failed in the real workspace; the touched files were restored.'
              : 'The branch applied, but verification failed and the automatic restore also failed. Inspect the workspace.',
          }
        }
      }
      branch.promotedAt = Date.now()
      saveState(state)
      return {
        ok: true,
        mode: 'git',
        applied: parsePorcelain(status.stdout),
        conflicts: [],
        verify,
        message: `Patch applied to the workspace (not committed)${verify ? ' and verification passed' : ''}.`,
      }
    }

    const manifest = readBranchManifest(group, branch)
    const changes = compareTree(branch.workspace, manifest)
    const applied = []
    const conflicts = []
    const actions = []
    const allowDeletions = options.applyDeletions === true
    const rollbackDir = join(group.cwd, STUDIO_DIR, group.id, 'meta', branch.id, 'rollback')
    for (const file of changes.files) {
      const basePath = resolve(group.cwd, file.path)
      if (!inside(group.cwd, basePath)) {
        conflicts.push({ path: file.path, reason: 'outside the workspace' })
        continue
      }
      const base = manifest.files[file.path]
      let current = null
      try {
        current = statSync(basePath)
      } catch {
        current = null
      }
      if (file.status === 'deleted') {
        if (!allowDeletions) continue
        if (current && base && (current.size !== base.s || Math.abs(current.mtimeMs - base.m) > 2000)) {
          conflicts.push({ path: file.path, reason: 'changed in the workspace while the branch ran' })
          continue
        }
        if (current) {
          const backup = join(rollbackDir, 'files', file.path)
          mkdirSync(dirname(backup), { recursive: true })
          copyFileSync(basePath, backup)
          actions.push({ path: file.path, existed: true, deleted: true })
        }
        rmSync(basePath, { force: true })
        applied.push({ path: file.path, status: 'deleted' })
        continue
      }
      if (!base && current) {
        conflicts.push({ path: file.path, reason: 'a file with this name appeared in the workspace' })
        continue
      }
      if (base && (!current || current.size !== base.s || Math.abs(current.mtimeMs - base.m) > 2000)) {
        conflicts.push({ path: file.path, reason: 'changed in the workspace while the branch ran' })
        continue
      }
      if (current) {
        const backup = join(rollbackDir, 'files', file.path)
        mkdirSync(dirname(backup), { recursive: true })
        copyFileSync(basePath, backup)
        actions.push({ path: file.path, existed: true, deleted: false })
      } else {
        actions.push({ path: file.path, existed: false, deleted: false })
      }
      mkdirSync(dirname(basePath), { recursive: true })
      copyFileSync(join(branch.workspace, file.path), basePath)
      applied.push({ path: file.path, status: file.status })
    }

    let verify = null
    if (verifyAfter && applied.length > 0) {
      verify = runVerifyIn(group.cwd, String(group.verify))
      if (!verify.ok) {
        let rolledBack = true
        for (const action of actions.slice().reverse()) {
          try {
            const basePath = resolve(group.cwd, action.path)
            if (action.existed) {
              copyFileSync(join(rollbackDir, 'files', action.path), basePath)
            } else {
              rmSync(basePath, { force: true })
            }
          } catch {
            rolledBack = false
          }
        }
        return {
          ok: false,
          mode: 'copy',
          applied,
          conflicts,
          verify,
          rolledBack,
          message: rolledBack
            ? 'Files were applied, but verification failed in the real workspace; every changed file was restored.'
            : 'Files were applied, but verification failed and the automatic restore was incomplete. Inspect the workspace.',
        }
      }
    }
    if (applied.length > 0) branch.promotedAt = Date.now()
    saveState(state)
    return {
      ok: conflicts.length === 0,
      mode: 'copy',
      applied,
      conflicts,
      verify,
      message: conflicts.length === 0
        ? `Applied ${applied.length} file(s) to the workspace${verify ? ' and verification passed' : ''}.`
        : `${applied.length} file(s) applied; ${conflicts.length} conflict(s) need a manual merge.`,
    }
  }

  /**
   * Notify the source conversation that a branch landed, without waking it.
   * @param {object} group - owning group.
   * @param {object} branch - promoted branch.
   * @param {object} result - promotion result.
   * @returns {void}
   */
  function notify(group, branch, result) {
    try {
      const agent = ctx.agents.get(group.sessionId)
      if (!agent || typeof agent.inject !== 'function') return
      const files = (result.applied ?? []).slice(0, 20).map(item => `- ${item.status === 'deleted' ? 'deleted' : item.status}: ${item.path}`).join('\n')
      const headline = result.rolledBack
        ? `Branch studio: branch "${branch.label}" applied but verification failed, so the change was rolled back and the workspace is unchanged.`
        : result.ok
          ? `Branch studio: branch "${branch.label}" was promoted into the workspace.`
          : `Branch studio: branch "${branch.label}" was partially promoted; some files need a manual merge.`
      const text = [
        headline,
        files ? `Files:\n${files}` : 'No file changes.',
        result.verify ? `Verification: ${result.verify.ok ? 'passed' : `failed (exit ${result.verify.code})`} - ${result.verify.command}` : '',
        branch.answer ? `Branch summary:\n${branch.answer.slice(0, 1200)}` : '',
        result.rolledBack || !result.ok
          ? 'Do not assume the workspace contains this branch; ask the user how to proceed.'
          : 'Continue from this state when the user next asks; the workspace already contains the promoted changes.',
      ].filter(Boolean).join('\n\n')
      agent.inject({ content: [{ type: 'text', text }], source: { kind: 'branch-studio' } })
    } catch {
      // The note is helpful but never required.
    }
  }

  /**
   * Remove one group's workspaces and record, without persisting.
   * @param {object} group - group to remove.
   * @returns {void}
   */
  function discardGroup(group) {
    for (const branch of group.branches ?? []) {
      const entry = running.get(branch.id)
      if (entry) {
        if (entry.tokenTimer) clearInterval(entry.tokenTimer)
        try {
          entry.controller.abort()
        } catch {
          // ignore
        }
        running.delete(branch.id)
      }
      const target = group.mode === 'git' ? (branch.worktreePath ?? branch.workspace) : branch.workspace
      if (!target) continue
      const allowed = inside(group.cwd, target) || (group.repo ? inside(group.repo, target) : false)
      if (!allowed) {
        // A corrupted or hand-edited state must not turn archive into an
        // arbitrary delete outside the studio roots.
        log(`skip deleting workspace outside the studio: ${target}`)
        continue
      }
      try {
        if (group.mode === 'git') {
          const removed = git(group.repo, ['worktree', 'remove', '--force', target])
          if (removed.status !== 0 && existsSync(target)) rmSync(target, { recursive: true, force: true })
        } else {
          rmSync(target, { recursive: true, force: true })
        }
      } catch {
        // a locked workspace is pruned at the next attempt
      }
    }
    try {
      const root = join(group.cwd, STUDIO_DIR, group.id)
      if (existsSync(root)) rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
    state.groups = state.groups.filter(item => item.id !== group.id)
    if (group.mode === 'git') git(group.repo, ['worktree', 'prune'])
  }

  /**
   * Remove one group and persist the new state.
   * @param {object} group - group to remove.
   * @returns {void}
   */
  function removeGroup(group) {
    discardGroup(group)
    saveState(state)
  }

  /**
   * Keep the persisted history bounded. Only old, fully settled groups are
   * dropped, so a running or recent exploration is never deleted implicitly.
   * @returns {void}
   */
  function pruneGroups() {
    const keep = Math.max(1, Number(cfg.keepGroups) || 0)
    if (state.groups.length <= keep) return
    const cutoff = Date.now() - Math.max(0, Number(cfg.keepDays) || 0) * 86400000
    const terminal = group => (group.branches ?? []).every(branch =>
      branch.status !== 'preparing' && branch.status !== 'queued' && branch.status !== 'running')
    const removable = state.groups
      .filter(group => terminal(group) && (group.createdAt ?? 0) < cutoff)
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
    let removed = 0
    for (const group of removable) {
      if (state.groups.length <= keep) break
      discardGroup(group)
      removed += 1
    }
    if (removed > 0) {
      log(`pruned ${removed} old branch group(s)`)
      saveState(state)
    }
  }

  /**
   * Remove studio leftovers that no persisted group/branch owns: group
   * directories from deleted state, branch directories from deleted branches,
   * stale base manifests, day-old verify scripts and pruned git worktrees.
   * @returns {void}
   */
  function sweepStudio() {
    const roots = new Set([
      ...(state.roots ?? []),
      ...state.groups.map(group => group.cwd),
      ...state.groups.map(group => group.repo).filter(Boolean),
    ])
    for (const root of roots) {
      const studio = join(root, STUDIO_DIR)
      if (!existsSync(studio)) continue
      const known = new Map(state.groups.map(group => [group.id, group]))
      let entries
      try {
        entries = readdirSync(studio, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(studio, entry.name)
        const group = known.get(entry.name)
        if (!group) {
          // A group directory deleted less than the grace window ago may belong
          // to a concurrent host or a state write still in flight; keep it.
          try {
            const grace = Math.max(0, Number(cfg.sweepGraceMs) || 0)
            if (grace > 0 && Date.now() - statSync(dir).mtimeMs < grace) continue
          } catch {
            continue
          }
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* locked */ }
          continue
        }
        const branchIds = new Set((group.branches ?? []).map(branch => branch.id))
        let subs
        try { subs = readdirSync(dir, { withFileTypes: true }) } catch { continue }
        for (const sub of subs) {
          const target = join(dir, sub.name)
          if (sub.isDirectory()) {
            if (sub.name === 'meta') continue
            if (!branchIds.has(sub.name)) {
              try { rmSync(target, { recursive: true, force: true }) } catch { /* locked */ }
            }
          } else if (sub.name.endsWith('.base.json')) {
            const id = sub.name.slice(0, -'.base.json'.length)
            if (!branchIds.has(id)) {
              try { rmSync(target, { force: true }) } catch { /* locked */ }
            }
          }
        }
      }
    }
    try {
      const dir = join(dshHome(), 'branch-studio', '.verify')
      if (existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          const file = join(dir, name)
          try {
            if (Date.now() - statSync(file).mtimeMs > 86400000) rmSync(file, { force: true })
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    for (const repo of new Set(state.groups.map(group => group.repo).filter(Boolean))) {
      git(repo, ['worktree', 'prune'])
    }
  }

  /**
   * Create one group and start its branches.
   * @param {object} input - creation request.
   * @returns {object} created group.
   */
  async function createGroup(input) {
    const sessionId = String(input.sessionId ?? '')
    const agent = ctx.agents.get(sessionId)
    if (!agent) throw new Error('session is not live')
    const cwd = cwdOf(agent)
    const goal = String(input.goal ?? '').trim()
    if (!goal) throw new Error('a goal is required')
    const specs = Array.isArray(input.branches) ? input.branches : []
    if (specs.length < 1 || specs.length > cfg.maxBranches) {
      throw new Error(`provide 1-${cfg.maxBranches} branches`)
    }
    const title = String(input.title ?? '').trim() || goal.slice(0, 60)
    const gitInfo = detectGit(cwd)
    const group = {
      id: shortId('g'),
      sessionId,
      title,
      goal,
      cwd,
      mode: gitInfo ? 'git' : 'copy',
      repo: gitInfo?.repo ?? null,
      head: gitInfo?.head ?? null,
      studioRoot: join(cwd, STUDIO_DIR),
      createdAt: Date.now(),
      inherit: input.inherit !== false,
      verify: String(input.verify ?? '').trim(),
      maxTokens: Number(input.maxTokens) > 0 ? Number(input.maxTokens) : (cfg.maxTokensPerBranch > 0 ? cfg.maxTokensPerBranch : 0),
      branches: [],
    }
    if (group.mode === 'git') excludeStudioDir(group.repo)
    if (group.mode === 'copy') {
      // Volume checks happen once, before any copy starts; each branch then
      // captures its own base manifest right after its copy.
      const listing = walkTree(cwd)
      group.copySize = { bytes: listing.bytes, files: listing.files.length }
      if (listing.bytes > cfg.maxCopyMB * 1024 * 1024) {
        throw new Error(`workspace is ${(listing.bytes / 1048576).toFixed(0)} MB; the hard copy limit is ${cfg.maxCopyMB} MB (configure maxCopyMB or use a git repository)`)
      }
      if (listing.files.length > cfg.maxCopyFiles) {
        throw new Error(`workspace has ${listing.files.length} files; the copy limit is ${cfg.maxCopyFiles} (configure maxCopyFiles or use a git repository)`)
      }
      const warnBytes = Number(cfg.copyWarnMB) > 0 ? Number(cfg.copyWarnMB) * 1024 * 1024 : 0
      if (warnBytes > 0 && listing.bytes > warnBytes && input.confirmCopy !== true) {
        throw new Error(`workspace is ${(listing.bytes / 1048576).toFixed(0)} MB, over the ${cfg.copyWarnMB} MB copy comfort limit; pass confirmCopy: true to copy anyway, or use a git repository`)
      }
    }
    state.roots = [...new Set([...(state.roots ?? []), cwd, group.repo].filter(Boolean))].slice(-20)
    for (const [index, spec] of specs.entries()) {
      const label = String(spec.label ?? `Branch ${index + 1}`).trim().slice(0, 40) || `Branch ${index + 1}`
      // The UI sends flat provider/model fields; tools send a nested model object.
      const raw = spec.model && typeof spec.model === 'object' ? spec.model : spec
      const model = {
        provider: String(raw.provider ?? '').trim(),
        model: String(raw.model ?? '').trim(),
        ...(raw.reasoningEffort ? { reasoningEffort: String(raw.reasoningEffort) } : {}),
      }
      group.branches.push({
        id: shortId('b'),
        label,
        angle: String(spec.angle ?? '').slice(0, 2000),
        prompt: '',
        model: model && model.provider && model.model ? model : null,
        inherit: input.inherit !== false,
        maxTokens: group.maxTokens,
        status: 'preparing',
        workspace: null,
        progress: null,
        childId: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        tokens: null,
        answer: '',
        error: '',
        diagnostic: '',
        stopReason: null,
        files: [],
        stat: '',
        patchPath: null,
        baseManifestPath: null,
        verify: null,
        warning: '',
      })
    }
    state.groups.push(group)
    saveState(state)
    pruneGroups()

    // Prepare workspaces and start children in the background: copying a large
    // workspace must not block the HTTP request or the tool call.
    void (async () => {
      for (const branch of group.branches) {
        try {
          const prepared = await prepareWorkspace(group, branch)
          branch.workspace = prepared.workspace
          branch.warning = prepared.warning
          branch.prompt = composePrompt(group, branch)
          saveState(state)
          await startBranch(group, branch)
        } catch (error) {
          branch.status = 'error'
          branch.progress = null
          branch.error = error instanceof Error ? error.message : String(error)
          branch.endedAt = Date.now()
          saveState(state)
        }
      }
    })()

    return groupRow(group)
  }

  // ------------------------------------------------------------------ tools

  ctx.tools.register(defineTool({
    name: 'branch_start',
    description: 'Start parallel exploration branches from this session. Each branch runs in its own isolated workspace (git worktree or directory copy) with its own prompt and model, so several approaches can be tried at once. Returns immediately; use branch_list or branch_compare to follow progress.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The shared goal for all branches' },
        title: { type: 'string', description: 'Short group title (defaults to the goal)' },
        inherit: { type: 'boolean', description: 'true (default): branches inherit this conversation; false: clean-room branches' },
        verify: { type: 'string', description: 'Optional shell command run inside every branch workspace after it finishes (e.g. "npm test")' },
        maxTokens: { type: 'integer', description: 'Optional token budget per branch; 0 disables the cap' },
        confirmCopy: { type: 'boolean', description: 'Set true to copy a non-git workspace larger than copyWarnMB (default 300 MB); a git repository is faster' },
        branches: {
          type: 'array',
          description: '1-4 branches',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short branch label' },
              angle: { type: 'string', description: 'What this branch should focus on, different from the others' },
              provider: { type: 'string', description: 'Optional model provider override' },
              model: { type: 'string', description: 'Optional model id override' },
              reasoningEffort: { type: 'string', description: 'Optional reasoning effort override' },
            },
          },
        },
      },
      required: ['goal', 'branches'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const sessionId = assertTopLevel(exec)
      const branches = (args.branches ?? []).map(branch => ({
        label: branch.label,
        angle: branch.angle,
        model: (branch.provider && branch.model)
          ? { provider: branch.provider, model: branch.model, reasoningEffort: branch.reasoningEffort }
          : undefined,
      }))
      const group = await createGroup({
        sessionId,
        goal: args.goal,
        title: args.title,
        inherit: args.inherit !== false,
        verify: args.verify,
        maxTokens: args.maxTokens,
        confirmCopy: args.confirmCopy === true,
        branches,
      })
      return [
        `Started ${group.branches.length} branch(es) in group ${group.id} ("${group.title}", ${group.mode} isolation).`,
        ...group.branches.map(branch => `- ${branch.label} (${branch.model ? `${branch.model.provider}/${branch.model.model}` : 'this session model'})`),
        'They are preparing in the background. Call branch_compare when they finish, then branch_promote with the winning branch id.',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'branch_list',
    description: 'List this session branch groups and their branch status (running/completed/error), model, duration, tokens and changed-file counts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      const sessionId = assertTopLevel(exec)
      const groups = groupsFor(sessionId)
      if (groups.length === 0) return 'No branch groups yet. Use branch_start to fan out.'
      return groups.map(group => [
        `Group ${group.id} "${group.title}" (${group.mode}) - ${group.branches.length} branch(es)`,
        ...group.branches.map(branch => {
          const progress = branch.progress?.phase === 'copying'
            ? `, copying ${((branch.progress.bytes ?? 0) / 1048576).toFixed(1)}/${((branch.progress.totalBytes ?? 0) / 1048576).toFixed(1)} MB`
            : branch.progress?.phase === 'worktree' ? ', creating worktree'
              : branch.progress?.phase === 'starting' ? ', starting' : ''
          return `  [${branch.id}] ${branch.label}: ${branch.status}${progress}, ${branch.model ? `${branch.model.provider}/${branch.model.model}` : 'inherited model'}, ${branch.durationMs ? `${(branch.durationMs / 1000).toFixed(1)}s` : '-'}, ${branch.tokens ?? '-'} tokens, ${branch.files.length} file(s)`
        }),
      ].join('\n')).join('\n\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'branch_compare',
    description: 'Compare the branches of one group: answer summary, file changes, verification result, tokens and duration. Use it to pick a winner before branch_promote.',
    parameters: {
      type: 'object',
      properties: { group: { type: 'string', description: 'Group id (defaults to the newest group)' } },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const sessionId = assertTopLevel(exec)
      const groups = groupsFor(sessionId)
      const group = args.group ? groups.find(item => item.id === args.group) : groups[0]
      if (!group) return 'No such branch group.'
      return group.branches.map(branch => [
        `### ${branch.label} [${branch.id}] - ${branch.status}`,
        `model: ${branch.model ? `${branch.model.provider}/${branch.model.model}` : 'inherited'} | ${branch.durationMs ? `${(branch.durationMs / 1000).toFixed(1)}s` : '-'} | ${branch.tokens ?? '-'} tokens`,
        `files: ${branch.stat || '(none)'}`,
        branch.verify ? `verify: ${branch.verify.ok ? 'PASS' : `FAIL (${branch.verify.code})`} - ${branch.verify.command}` : '',
        branch.error ? `error: ${branch.error}` : '',
        branch.answer ? `answer:\n${branch.answer.slice(0, 1500)}` : '(no answer yet)',
      ].filter(Boolean).join('\n')).join('\n\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'branch_promote',
    description: 'Apply one completed branch\'s file changes back into the real workspace. In a git repository this applies a patch; otherwise changed files are copied after a conflict check. The source conversation is notified without waking it.',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch id from branch_compare' },
        applyDeletions: { type: 'boolean', description: 'Also delete files the branch deleted (default false)' },
        verifyAfter: { type: 'boolean', description: 'Run the group verification command in the real workspace after applying, and roll back if it fails (default true)' },
      },
      required: ['branch'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const sessionId = assertTopLevel(exec)
      const found = branchOf(String(args.branch ?? ''), sessionId)
      if (!found) throw new Error('no such branch in this session')
      const result = promote(found.group, found.branch, { applyDeletions: args.applyDeletions === true, verifyAfter: args.verifyAfter !== false })
      notify(found.group, found.branch, result)
      return [
        result.message,
        result.applied.length ? `applied:\n${result.applied.map(file => `- ${file.status}: ${file.path}`).join('\n')}` : '',
        result.conflicts.length ? `conflicts:\n${result.conflicts.map(file => `- ${file.path}: ${file.reason}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'branch_archive',
    description: 'Delete one branch group and its isolated workspaces. Promoted changes stay in the workspace; unpromoted work is lost.',
    parameters: {
      type: 'object',
      properties: { group: { type: 'string', description: 'Group id' } },
      required: ['group'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const sessionId = assertTopLevel(exec)
      const group = groupOf(String(args.group ?? ''))
      if (!group || group.sessionId !== sessionId) throw new Error('no such group in this session')
      removeGroup(group)
      return `Archived group ${group.id}.`
    },
  }))

  // ----------------------------------------------------------------- routes

  /**
   * JSON response.
   * @param {number} status - HTTP status.
   * @param {object} body - payload.
   * @returns {Response} response.
   */
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

  /**
   * Wrap a route handler with uniform errors.
   * @param {(request: Request) => Promise<object>} handler - body.
   * @returns {(request: Request) => Promise<Response>} route.
   */
  const route = handler => async request => {
    try {
      return json(200, { ok: true, ...(await handler(request)) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return json(/required|no such|only a completed|provide|needs a live|copy limit|not live/.test(message) ? 400 : 500, {
        ok: false,
        error: { message },
      })
    }
  }

  const routes = [
    {
      path: '/api/branch-studio/state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        return { groups: groupsFor(sessionId), limits: { maxBranches: cfg.maxBranches, maxCopyMB: cfg.maxCopyMB } }
      }),
    },
    {
      path: '/api/branch-studio/meta',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const sessionId = new URL(request.url).searchParams.get('sessionId') ?? ''
        const agent = sessionId ? ctx.agents.get(sessionId) : undefined
        const cwd = agent ? cwdOf(agent) : process.cwd()
        const gitInfo = detectGit(cwd)
        const model = agent?.model?.current?.() ?? null
        return {
          cwd,
          mode: gitInfo ? 'git' : 'copy',
          repo: gitInfo?.repo ?? null,
          model,
          limits: { maxBranches: cfg.maxBranches, maxCopyMB: cfg.maxCopyMB },
        }
      }),
    },
    {
      path: '/api/branch-studio/create',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const body = await request.json()
        const group = await createGroup({
          sessionId: body.sessionId,
          goal: body.goal,
          title: body.title,
          inherit: body.inherit !== false,
          verify: body.verify,
          maxTokens: body.maxTokens,
          confirmCopy: body.confirmCopy === true,
          branches: body.branches,
        })
        return { group }
      }),
    },
    {
      path: '/api/branch-studio/promote',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const body = await request.json()
        const sessionId = String(body.sessionId ?? '')
        const found = branchOf(String(body.branch ?? ''), sessionId)
        if (!found) throw new Error('no such branch in this session')
        const result = promote(found.group, found.branch, { applyDeletions: body.applyDeletions === true, verifyAfter: body.verifyAfter !== false })
        notify(found.group, found.branch, result)
        return { result }
      }),
    },
    {
      path: '/api/branch-studio/verify',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const body = await request.json()
        const sessionId = String(body.sessionId ?? '')
        const found = branchOf(String(body.branch ?? ''), sessionId)
        if (!found) throw new Error('no such branch in this session')
        if (!found.group.verify) throw new Error('this group has no verify command')
        const verify = runVerify(found.group, found.branch)
        found.branch.verify = verify
        saveState(state)
        return { verify }
      }),
    },
    {
      path: '/api/branch-studio/diff',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const found = branchOf(String(url.searchParams.get('branch') ?? ''), sessionId)
        if (!found) throw new Error('no such branch in this session')
        let text = ''
        try {
          text = readFileSync(found.branch.patchPath, 'utf8')
        } catch {
          text = ''
        }
        return { text }
      }),
    },
    {
      path: '/api/branch-studio/archive',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: route(async request => {
        const body = await request.json()
        const group = groupOf(String(body.group ?? ''))
        if (!group || group.sessionId !== String(body.sessionId ?? '')) throw new Error('no such group in this session')
        removeGroup(group)
        return { archived: group.id }
      }),
    },
  ]

  for (const definition of routes) {
    ctx.effect(() => ctx.connection.fetch.register(definition), `branch-studio: ${definition.path}`)
  }

  ctx.effect(() => () => {
    // Reloading the plugin must not leave invisible child agents running.
    for (const entry of running.values()) {
      if (entry.tokenTimer) clearInterval(entry.tokenTimer)
      try {
        entry.controller.abort()
      } catch {
        // ignore
      }
    }
    running.clear()
  }, 'branch-studio: running branches')
}

