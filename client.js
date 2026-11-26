/**
 * Branch studio — Client half.
 *
 * A composer trigger plus a frame overlay: create parallel exploration
 * branches, watch them run, compare answers/files/verification, and promote
 * one back into the workspace. All data comes from the Host half over the
 * authenticated `/api/branch-studio/*` routes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-branch-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-branch-studio'
    const MAX_BRANCHES = 4

    const zh = {
      title: '分支工作室',
      open: '分支',
      create: '新建探索',
      history: '记录',
      goal: '共同目标',
      goalPh: '例如：把设置页的加载速度提升一倍，并保持现有行为',
      titlePh: '给这次探索起个名字（可选）',
      inherit: '继承当前对话',
      inheritHint: '开启：每个分支从当前对话的真实历史继续（fork）；关闭：全新上下文，只带目标',
      confirmCopy: '允许复制超过 300 MB 的目录（慢，建议用 git 仓库）',
      copying: '复制中',
      creatingWorktree: '创建 worktree…',
      startingBranch: '启动中…',
      verify: '验证命令',
      verifyPh: '例如 npm test（每个分支跑一遍，提升后在真实工作区再验一次）',
      verifyHint: '以你的用户权限在分支目录里运行；只填你信任的命令',
      maxTokens: '每分支 token 上限',
      maxTokensPh: '0 = 不限制',
      branches: '分支',
      addBranch: '添加分支',
      remove: '移除',
      label: '标签',
      angle: '这条分支的角度',
      anglePh: '例如：最小改动；或：重写成更清晰的架构',
      model: '模型',
      provider: 'provider',
      providerPh: '留空 = 继承当前模型',
      modelPh: '模型 id',
      effort: '推理强度',
      effortPh: '可选，如 high / max',
      start: '开始探索',
      starting: '正在准备分支…',
      empty: '还没有分支记录',
      noGroups: '还没有探索记录。先创建一组分支，或者直接在对话里让 agent 调用 branch_start。',
      newGroup: '新建探索',
      group: '探索',
      status: '状态',
      title: '标题',
      running: '运行中',
      queued: '等待名额',
      preparing: '准备中',
      completed: '完成',
      error: '失败',
      interrupted: '已中断',
      tokens: 'tokens',
      duration: '耗时',
      files: '文件',
      verifyOk: '验证通过',
      verifyFail: '验证失败',
      verifyNone: '未验证',
      verifyAfter: '提升后在真实工作区复验（失败自动回滚）',
      answer: '回答',
      noAnswer: '（还没有回答）',
      diff: '改动',
      promote: '提升',
      promoting: '提升中…',
      promoted: '已提升',
      rolledBack: '已自动回滚',
      archive: '清理',
      compare: '对比',
      detail: '详情',
      back: '返回',
      workspace: '工作区',
      modeGit: 'git 隔离（worktree）',
      modeCopy: '目录副本隔离',
      created: '创建于',
      cancel: '取消',
      confirmArchive: '确定删除这组分支及其隔离目录？未提升的改动会丢失。',
      promoteResult: '提升结果',
      diffTitle: '分支改动',
      loading: '加载中…',
      budgetExceeded: '超出预算',
      refresh: '刷新',
      errorPrefix: '出错',
      noGoal: '请填写共同目标',
      copyHint: '当前目录不是 git 仓库：每个分支复制一份工作区，提升时按文件回写。',
      gitHint: '当前目录是 git 仓库：每个分支用独立 worktree，提升时应用补丁。',
      budgetHint: '含继承上下文的计费 token；超限自动中断该分支',
      conflicts: '冲突',
      applied: '已写入',
      emptyDiff: '这个分支没有文件改动',
    }

    const en = {
      title: 'Branch studio',
      open: 'Branches',
      create: 'New exploration',
      history: 'History',
      goal: 'Shared goal',
      goalPh: 'e.g. make the settings page load twice as fast without changing behavior',
      titlePh: 'Name this exploration (optional)',
      inherit: 'Inherit this conversation',
      inheritHint: 'On: each branch continues the real conversation history (fork). Off: clean context with only the goal.',
      confirmCopy: 'Allow copying a workspace over 300 MB (slow; prefer a git repository)',
      copying: 'Copying',
      creatingWorktree: 'Creating worktree…',
      startingBranch: 'Starting…',
      verify: 'Verify command',
      verifyPh: 'e.g. npm test — runs in every branch, then again in the real workspace after promotion',
      verifyHint: 'Runs with your user permissions inside the branch workspace; only enter commands you trust',
      maxTokens: 'Token cap per branch',
      maxTokensPh: '0 = unlimited',
      branches: 'Branches',
      addBranch: 'Add branch',
      remove: 'Remove',
      label: 'Label',
      angle: 'This branch’s angle',
      anglePh: 'e.g. smallest possible change; or: rewrite for clarity',
      model: 'Model',
      provider: 'provider',
      providerPh: 'empty = inherit the current model',
      modelPh: 'model id',
      effort: 'Reasoning effort',
      effortPh: 'optional, e.g. high / max',
      start: 'Start exploring',
      starting: 'Preparing branches…',
      empty: 'No branches yet',
      noGroups: 'No explorations yet. Create one, or ask the agent to call branch_start.',
      newGroup: 'New exploration',
      group: 'Exploration',
      status: 'Status',
      title: 'Title',
      running: 'Running',
      queued: 'Queued',
      preparing: 'Preparing',
      completed: 'Completed',
      error: 'Failed',
      interrupted: 'Interrupted',
      tokens: 'tokens',
      duration: 'took',
      files: 'files',
      verifyOk: 'verify passed',
      verifyFail: 'verify failed',
      verifyNone: 'not verified',
      verifyAfter: 'Re-verify in the real workspace after promotion (roll back on failure)',
      answer: 'Answer',
      noAnswer: '(no answer yet)',
      diff: 'Changes',
      promote: 'Promote',
      promoting: 'Promoting…',
      promoted: 'Promoted',
      rolledBack: 'Rolled back',
      archive: 'Archive',
      compare: 'Compare',
      detail: 'Details',
      back: 'Back',
      workspace: 'Workspace',
      modeGit: 'git worktree isolation',
      modeCopy: 'directory copy isolation',
      created: 'created',
      cancel: 'Cancel',
      confirmArchive: 'Delete this exploration and its isolated workspaces? Unpromoted work is lost.',
      promoteResult: 'Promotion result',
      diffTitle: 'Branch changes',
      loading: 'Loading…',
      budgetExceeded: 'budget exceeded',
      refresh: 'Refresh',
      errorPrefix: 'Error',
      noGoal: 'Please fill in the shared goal',
      copyHint: 'Not a git repository: each branch copies the workspace; promotion writes files back after a conflict check.',
      gitHint: 'Git repository: each branch uses its own worktree; promotion applies a patch.',
      budgetHint: 'Billed tokens including inherited context; the branch stops at the cap',
      conflicts: 'Conflicts',
      applied: 'Applied',
      emptyDiff: 'This branch made no file changes',
    }

    // ------------------------------------------------------------------ store

    /**
     * Minimal external store shared by the trigger and the panel.
     * @param {object} initial - initial state.
     * @returns {object} store.
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      const emit = () => listeners.forEach(listener => listener())
      return {
        get: () => state,
        set: updater => {
          const next = typeof updater === 'function' ? updater(state) : updater
          if (next !== state) {
            state = next
            emit()
          }
        },
        subscribe: listener => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        use: () => useSyncExternalStore(
          listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          () => state,
          () => state,
        ),
      }
    }

    /** @returns {object} one empty branch form row. */
    const blankBranch = index => ({
      label: String.fromCharCode(65 + index),
      angle: '',
      provider: '',
      model: '',
      effort: '',
    })

    const store = createStore({
      open: false,
      sessionId: null,
      groups: [],
      meta: null,
      limits: null,
      selectedId: null,
      view: 'create',
      loading: false,
      busy: false,
      error: null,
      banner: null,
      compare: false,
      verifyAfter: true,
      form: {
        goal: '',
        title: '',
        inherit: true,
        confirmCopy: false,
        verify: '',
        maxTokens: 0,
        branches: [blankBranch(0), blankBranch(1)],
      },
      diff: { open: false, title: '', text: '', loading: false },
    })

    /**
     * Fetch one branch-studio route.
     * @param {string} path - route path.
     * @param {object} [options] - fetch options.
     * @returns {Promise<object>} payload.
     */
    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!body || body.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      return body
    }

    /**
     * Refresh groups and metadata for the open session.
     * @returns {Promise<void>}
     */
    async function refresh() {
      const { sessionId, selectedId } = store.get()
      if (!sessionId) return
      try {
        const [state, meta] = await Promise.all([
          api(`/api/branch-studio/state?sessionId=${encodeURIComponent(sessionId)}`),
          api(`/api/branch-studio/meta?sessionId=${encodeURIComponent(sessionId)}`),
        ])
        store.set(current => {
          const groups = state.groups ?? []
          const stillThere = groups.some(group => group.id === selectedId)
          return {
            ...current,
            groups,
            meta,
            limits: state.limits ?? current.limits,
            selectedId: stillThere ? selectedId : null,
            view: stillThere || current.view === 'create' ? current.view : 'create',
            loading: false,
          }
        })
      } catch (error) {
        store.set(current => ({ ...current, loading: false, error: error.message }))
      }
    }

    /**
     * Create the exploration described by the form.
     * @returns {Promise<void>}
     */
    async function createGroup() {
      const { sessionId, form } = store.get()
      if (!sessionId) return
      if (!form.goal.trim()) {
        store.set(current => ({ ...current, error: '请填写共同目标 / Please fill in the shared goal' }))
        return
      }
      const branches = form.branches
        .map(branch => ({
          label: branch.label.trim() || 'Branch',
          angle: branch.angle.trim(),
          ...(branch.provider.trim() && branch.model.trim()
            ? { provider: branch.provider.trim(), model: branch.model.trim(), ...(branch.effort.trim() ? { reasoningEffort: branch.effort.trim() } : {}) }
            : {}),
        }))
        .filter(branch => branch.angle || branch.label)
      store.set(current => ({ ...current, busy: true, error: null, banner: null }))
      try {
        const body = await api('/api/branch-studio/create', {
          method: 'POST',
          body: JSON.stringify({
            sessionId,
            goal: form.goal,
            title: form.title,
            inherit: form.inherit,
            confirmCopy: form.confirmCopy === true,
            verify: form.verify,
            maxTokens: Number(form.maxTokens) || 0,
            branches,
          }),
        })
        store.set(current => ({
          ...current,
          busy: false,
          selectedId: body.group?.id ?? null,
          view: 'group',
          compare: false,
          banner: { kind: 'ok', text: `${body.group?.branches?.length ?? 0} 个分支已开始准备` },
        }))
        await refresh()
      } catch (error) {
        store.set(current => ({ ...current, busy: false, error: error.message }))
      }
    }

    /**
     * Promote one branch and report the result.
     * @param {string} branchId - branch id.
     * @returns {Promise<void>}
     */
    async function promoteBranch(branchId) {
      store.set(current => ({ ...current, busy: true, error: null, banner: null }))
      try {
        const body = await api('/api/branch-studio/promote', {
          method: 'POST',
          body: JSON.stringify({ sessionId: store.get().sessionId, branch: branchId, applyDeletions: false, verifyAfter: store.get().verifyAfter !== false }),
        })
        const result = body.result ?? {}
        store.set(current => ({
          ...current,
          busy: false,
          banner: {
            kind: result.rolledBack ? 'bad' : result.ok ? 'ok' : 'warn',
            text: result.message ?? '',
            detail: [
              ...(result.applied ?? []).slice(0, 12).map(item => `${item.status}: ${item.path}`),
              ...(result.conflicts ?? []).slice(0, 6).map(item => `conflict: ${item.path} — ${item.reason}`),
              result.verify ? `verify: ${result.verify.ok ? 'PASS' : `FAIL (${result.verify.code})`}` : '',
            ].filter(Boolean).join('\n'),
          },
        }))
        await refresh()
      } catch (error) {
        store.set(current => ({ ...current, busy: false, error: error.message }))
      }
    }

    /**
     * Archive one group.
     * @param {string} groupId - group id.
     * @returns {Promise<void>}
     */
    async function archiveGroup(groupId, message) {
      if (!window.confirm(message || zh.confirmArchive)) return
      store.set(current => ({ ...current, busy: true, error: null }))
      try {
        await api('/api/branch-studio/archive', { method: 'POST', body: JSON.stringify({ sessionId: store.get().sessionId, group: groupId }) })
        store.set(current => ({ ...current, busy: false, selectedId: null, view: 'create', banner: null }))
        await refresh()
      } catch (error) {
        store.set(current => ({ ...current, busy: false, error: error.message }))
      }
    }

    /**
     * Load and show one branch's diff.
     * @param {object} branch - branch row.
     * @returns {Promise<void>}
     */
    async function showDiff(branch) {
      store.set(current => ({ ...current, diff: { open: true, title: `${branch.label} — ${zh.diffTitle}`, text: '', loading: true } }))
      try {
        const body = await api(`/api/branch-studio/diff?branch=${encodeURIComponent(branch.id)}&sessionId=${encodeURIComponent(store.get().sessionId ?? '')}`)
        store.set(current => ({ ...current, diff: { ...current.diff, loading: false, text: body.text || '' } }))
      } catch (error) {
        store.set(current => ({ ...current, diff: { ...current.diff, loading: false, text: `${zh.errorPrefix}: ${error.message}` } }))
      }
    }

    /**
     * Re-run the group verification for one branch.
     * @param {string} branchId - branch id.
     * @returns {Promise<void>}
     */
    async function reVerify(branchId) {
      store.set(current => ({ ...current, busy: true, error: null }))
      try {
        await api('/api/branch-studio/verify', { method: 'POST', body: JSON.stringify({ sessionId: store.get().sessionId, branch: branchId }) })
        store.set(current => ({ ...current, busy: false }))
        await refresh()
      } catch (error) {
        store.set(current => ({ ...current, busy: false, error: error.message }))
      }
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Format a duration.
     * @param {number|null} ms - milliseconds.
     * @returns {string} label.
     */
    function formatDuration(ms) {
      if (!ms) return '—'
      if (ms < 1000) return `${ms} ms`
      if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
      return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
    }

    /**
     * Format a token count.
     * @param {number|null} value - tokens.
     * @returns {string} label.
     */
    function formatTokens(value) {
      if (!value) return '—'
      if (value < 1000) return String(value)
      return `${(value / 1000).toFixed(1)}k`
    }

    /**
     * Format a byte count.
     * @param {number|null} value - bytes.
     * @returns {string} label.
     */
    function formatBytes(value) {
      if (value === null || value === undefined) return '—'
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
      if (value < 1024 * 1024 * 1024) return `${(value / 1048576).toFixed(1)} MB`
      return `${(value / 1073741824).toFixed(2)} GB`
    }

    /**
     * Short relative time label.
     * @param {string|null} isoString - ISO timestamp.
     * @returns {string} label.
     */
    function timeAgo(isoString) {
      if (!isoString) return '—'
      const delta = Date.now() - new Date(isoString).getTime()
      if (!Number.isFinite(delta)) return '—'
      if (delta < 60000) return 'just now'
      if (delta < 3600000) return `${Math.round(delta / 60000)} min ago`
      if (delta < 86400000) return `${Math.round(delta / 3600000)} h ago`
      return new Date(isoString).toLocaleDateString()
    }

    /**
     * Status pill.
     * @param {object} props - status and label translator.
     * @returns {object} element.
     */
    function StatusPill({ status, t }) {
      const map = {
        preparing: ['bs-pill-preparing', t('preparing')],
        queued: ['bs-pill-queued', t('queued')],
        running: ['bs-pill-running', t('running')],
        completed: ['bs-pill-completed', t('completed')],
        error: ['bs-pill-error', t('error')],
        interrupted: ['bs-pill-interrupted', t('interrupted')],
      }
      const [cls, label] = map[status] ?? ['bs-pill-interrupted', status]
      return h('span', { className: `bs-pill ${cls}` }, label)
    }

    /**
     * A labelled form row.
     * @param {object} props - label, hint, children.
     * @returns {object} element.
     */
    function Field({ label, hint, children }) {
      return h('label', { className: 'bs-field' },
        h('span', { className: 'bs-field-label' }, label),
        children,
        hint ? h('span', { className: 'bs-hint' }, hint) : null)
    }

    /**
     * Styles for the panel.
     * @returns {object} style element.
     */
    function Styles() {
      return h('style', null, CSS)
    }

    // ------------------------------------------------------------- components

    /**
     * Composer-row trigger.
     * @param {object} props - injected open action and translator.
     * @returns {object} button.
     */
    function Trigger(props) {
      const { open, t, sessionId } = props
      return h(React.Fragment, null,
        h(Styles),
        h('button', {
          type: 'button',
          className: 'bs-trigger',
          title: t('title'),
          'aria-haspopup': 'dialog',
          onClick: () => open(sessionId ?? null),
        }, h(BranchIcon, { size: 15 }), h('span', null, t('open'))))
    }

    /**
     * Branch glyph.
     * @param {object} props - size.
     * @returns {object} svg.
     */
    function BranchIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M4 12.5V7a3 3 0 0 1 3-3h2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('path', { d: 'M8 4h2.5a2.5 2.5 0 0 1 2.5 2.5V12', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { cx: 4, cy: 13, r: 1.4, fill: 'currentColor' }),
        h('circle', { cx: 8, cy: 4, r: 1.4, fill: 'currentColor' }),
        h('circle', { cx: 13, cy: 13, r: 1.4, fill: 'currentColor' }))
    }

    /**
     * One branch create row.
     * @param {object} props - row data, index, handlers, translator.
     * @returns {object} element.
     */
    function BranchFormRow({ branch, index, onChange, onRemove, canRemove, t, defaults }) {
      const [advanced, setAdvanced] = useState(false)
      return h('div', { className: 'bs-branchform' },
        h('div', { className: 'bs-branchform-head' },
          h('span', { className: 'bs-badge' }, `${index + 1}`),
          h('input', {
            className: 'bs-input bs-labelinput',
            value: branch.label,
            placeholder: t('label'),
            onChange: event => onChange({ ...branch, label: event.target.value }),
          }),
          h('span', { className: 'bs-modelsum' }, branch.provider && branch.model ? `${branch.provider}/${branch.model}` : (defaults ? `${defaults.provider}/${defaults.model}` : '')),
          canRemove ? h('button', { type: 'button', className: 'bs-link', onClick: onRemove }, t('remove')) : null),
        h('textarea', {
          className: 'bs-textarea bs-angle',
          value: branch.angle,
          placeholder: t('anglePh'),
          rows: 2,
          onChange: event => onChange({ ...branch, angle: event.target.value }),
        }),
        h('button', { type: 'button', className: 'bs-link bs-advanced', onClick: () => setAdvanced(value => !value) }, advanced ? '− model' : '+ model'),
        advanced ? h('div', { className: 'bs-modelrow' },
          h('input', { className: 'bs-input', value: branch.provider, placeholder: t('providerPh'), onChange: event => onChange({ ...branch, provider: event.target.value }) }),
          h('input', { className: 'bs-input', value: branch.model, placeholder: t('modelPh'), onChange: event => onChange({ ...branch, model: event.target.value }) }),
          h('input', { className: 'bs-input bs-effort', value: branch.effort, placeholder: t('effortPh'), onChange: event => onChange({ ...branch, effort: event.target.value }) })) : null)
    }

    /**
     * Create form.
     * @param {object} props - store state, actions, translator.
     * @returns {object} element.
     */
    function CreateView({ state, setState, onCreate, t }) {
      const form = state.form
      const defaults = state.meta?.model ?? null
      const setForm = patch => setState(current => ({ ...current, form: { ...current.form, ...patch } }))
      const setBranch = (index, value) => setForm({ branches: form.branches.map((branch, i) => (i === index ? value : branch)) })
      const addBranch = () => {
        if (form.branches.length >= MAX_BRANCHES) return
        setForm({ branches: [...form.branches, blankBranch(form.branches.length)] })
      }
      return h('div', { className: 'bs-create' },
        h('div', { className: 'bs-sectionhead' },
          h('h3', null, t('create')),
          h('span', { className: 'bs-cwd', title: state.meta?.cwd ?? '' }, state.meta?.cwd ?? '')),
        h(Field, { label: t('goal') },
          h('textarea', {
            className: 'bs-textarea bs-goal',
            rows: 3,
            value: form.goal,
            placeholder: t('goalPh'),
            onChange: event => setForm({ goal: event.target.value }),
          })),
        h('div', { className: 'bs-row2' },
          h(Field, { label: t('title') },
            h('input', { className: 'bs-input', value: form.title, placeholder: t('titlePh'), onChange: event => setForm({ title: event.target.value }) })),
          h(Field, { label: t('maxTokens'), hint: t('budgetHint') },
            h('input', {
              className: 'bs-input',
              type: 'number',
              min: 0,
              step: 10000,
              value: form.maxTokens,
              placeholder: t('maxTokensPh'),
              onChange: event => setForm({ maxTokens: Number(event.target.value) || 0 }),
            }))),
        h(Field, { label: t('verify'), hint: t('verifyHint') },
          h('input', { className: 'bs-input', value: form.verify, placeholder: t('verifyPh'), onChange: event => setForm({ verify: event.target.value }) })),
        h('label', { className: 'bs-check' },
          h('input', { type: 'checkbox', checked: form.inherit, onChange: event => setForm({ inherit: event.target.checked }) }),
          h('span', null, t('inherit')),
          h('span', { className: 'bs-hint' }, t('inheritHint'))),
        state.meta?.mode === 'copy' ? h('label', { className: 'bs-check' },
          h('input', { type: 'checkbox', checked: form.confirmCopy === true, onChange: event => setForm({ confirmCopy: event.target.checked }) }),
          h('span', null, t('confirmCopy'))) : null,
        h('div', { className: 'bs-modehint' }, icons(state.meta),
          h('span', null, state.meta?.mode === 'git' ? t('gitHint') : t('copyHint'))),
        h('div', { className: 'bs-sectionhead bs-brancheshead' },
          h('h4', null, `${t('branches')} · ${form.branches.length}`),
          form.branches.length < MAX_BRANCHES ? h('button', { type: 'button', className: 'bs-link', onClick: addBranch }, `+ ${t('addBranch')}`) : null),
        form.branches.map((branch, index) => h(BranchFormRow, {
          key: index,
          branch,
          index,
          defaults,
          t,
          canRemove: form.branches.length > 1,
          onChange: value => setBranch(index, value),
          onRemove: () => setForm({ branches: form.branches.filter((_, i) => i !== index) }),
        })),
        h('div', { className: 'bs-actions' },
          h('button', { type: 'button', className: 'bs-primary', disabled: state.busy || !form.goal.trim(), onClick: onCreate },
            state.busy ? t('starting') : t('start'))))
    }

    /**
     * Small mode icon.
     * @param {object} meta - session meta.
     * @returns {object} element.
     */
    function icons(meta) {
      return h('span', { className: 'bs-modebadge' }, meta?.mode === 'git' ? 'git' : 'copy')
    }

    /**
     * Compare table across branches.
     * @param {object} props - branches and translator.
     * @returns {object} element.
     */
    function CompareTable({ branches, t }) {
      const cols = branches.length > 0 ? branches : []
      if (cols.length === 0) return null
      const cell = (branch, key) => {
        if (key === 'status') return h(StatusPill, { status: branch.status, t })
        if (key === 'model') return branch.model ? `${branch.model.provider}/${branch.model.model}` : '—'
        if (key === 'duration') return formatDuration(branch.durationMs)
        if (key === 'tokens') return formatTokens(branch.tokens)
        if (key === 'files') return `${branch.files.length}`
        if (key === 'verify') {
          if (!branch.verify) return t('verifyNone')
          return branch.verify.ok ? 'PASS' : `FAIL ${branch.verify.code}`
        }
        return '—'
      }
      return h('div', { className: 'bs-compare' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', null, ''),
            cols.map(branch => h('th', { key: branch.id }, branch.label)))),
          h('tbody', null,
            ['status', 'model', 'duration', 'tokens', 'files', 'verify'].map(key => h('tr', { key },
              h('th', null, key === 'verify' ? t('verify') : t(key)),
              cols.map(branch => h('td', { key: branch.id }, cell(branch, key))))))),
        h('div', { className: 'bs-compare-answers' },
          cols.map(branch => h('div', { key: branch.id, className: 'bs-compare-answer' },
            h('div', { className: 'bs-compare-answerhead' }, h('strong', null, branch.label), h(StatusPill, { status: branch.status, t })),
            h('div', { className: 'bs-answer bs-answer-small' }, branch.answer || t('noAnswer'))))))
    }

    /**
     * Copy / worktree / startup progress line.
     * @param {object} props - progress and translator.
     * @returns {object} element.
     */
    function ProgressLine({ progress, t }) {
      if (progress.phase === 'copying') {
        const total = progress.totalBytes ?? 0
        const pct = total > 0 ? Math.min(100, Math.round(((progress.bytes ?? 0) / total) * 100)) : 0
        return h('div', { className: 'bs-progress' },
          h('div', { className: 'bs-progressbar' },
            h('div', { className: 'bs-progressfill', style: { width: `${pct}%` } })),
          h('span', null, `${t('copying')} ${formatBytes(progress.bytes)} / ${formatBytes(total)} · ${progress.files ?? 0} / ${progress.totalFiles ?? '?'} ${t('files')} (${pct}%)`))
      }
      return h('div', { className: 'bs-progress' },
        progress.phase === 'worktree' ? t('creatingWorktree') : t('startingBranch'))
    }

    /**
     * One branch card.
     * @param {object} props - branch, handlers, translator, busy.
     * @returns {object} element.
     */
    function BranchCard({ branch, onPromote, onDiff, onVerify, onCompare, t, busy }) {
      const [expanded, setExpanded] = useState(false)
      const running = branch.status === 'preparing' || branch.status === 'queued' || branch.status === 'running'
      return h('article', { className: 'bs-card' },
        h('header', { className: 'bs-cardhead' },
          h('div', { className: 'bs-cardtitle' },
            h(StatusPill, { status: branch.status, t }),
            h('strong', null, branch.label),
            branch.budgetExceeded ? h('span', { className: 'bs-warnpill' }, t('budgetExceeded')) : null),
          h('div', { className: 'bs-cardmeta' },
            h('span', null, branch.model ? `${branch.model.provider}/${branch.model.model}` : 'inherit'),
            h('span', null, formatDuration(branch.durationMs)),
            h('span', null, `${formatTokens(branch.tokens)} ${t('tokens')}`),
            h('span', null, `${branch.files.length} ${t('files')}`),
            branch.verify ? h('span', { className: branch.verify.ok ? 'bs-ok' : 'bs-bad' }, branch.verify.ok ? t('verifyOk') : t('verifyFail')) : null)),
        branch.warning ? h('div', { className: 'bs-hint bs-warning' }, branch.warning) : null,
        branch.progress && running ? h(ProgressLine, { progress: branch.progress, t }) : null,
        branch.error ? h('div', { className: 'bs-errorline' }, branch.error) : null,
        h('div', { className: `bs-answer ${expanded ? '' : 'bs-answer-clamp'}`, onClick: () => setExpanded(value => !value) },
          branch.answer || (running ? '…' : t('noAnswer'))),
        h('footer', { className: 'bs-cardactions' },
          h('button', { type: 'button', className: 'bs-link', onClick: () => onDiff(branch) }, t('diff')),
          onCompare ? h('button', { type: 'button', className: 'bs-link', onClick: onCompare }, t('compare')) : null,
          branch.verify && !running ? h('button', { type: 'button', className: 'bs-link', onClick: () => onVerify(branch.id) }, 're-verify') : null,
          h('button', {
            type: 'button',
            className: 'bs-primary bs-promote',
            disabled: busy || branch.status !== 'completed' || branch.promotedAt,
            onClick: () => onPromote(branch.id),
          }, branch.promotedAt ? t('promoted') : busy ? t('promoting') : t('promote'))))
    }

    /**
     * Group detail.
     * @param {object} props - group, state, actions, translator.
     * @returns {object} element.
     */
    function GroupView({ group, state, actions, t }) {
      const running = group.branches.some(branch => branch.status === 'preparing' || branch.status === 'queued' || branch.status === 'running')
      return h('div', { className: 'bs-group' },
        h('div', { className: 'bs-grouphead' },
          h('div', null,
            h('h3', null, group.title),
            h('div', { className: 'bs-groupline' },
              h('span', { className: 'bs-modebadge' }, group.mode === 'git' ? 'git' : 'copy'),
              h('span', null, group.cwd),
              h('span', null, `${t('created')} ${timeAgo(group.createdAt)}`),
              running ? h('span', { className: 'bs-runningdot' }, t('running')) : null)),
          h('div', { className: 'bs-groupactions' },
            h('button', { type: 'button', className: 'bs-link', onClick: () => actions.refresh() }, t('refresh')),
            h('button', { type: 'button', className: 'bs-link bs-danger', onClick: () => actions.archive(group.id) }, t('archive')))),
        group.verify ? h('div', { className: 'bs-verifyline' },
          h('code', null, group.verify),
          h('label', { className: 'bs-check bs-verifytoggle' },
            h('input', {
              type: 'checkbox',
              checked: state.verifyAfter !== false,
              onChange: event => actions.setVerifyAfter(event.target.checked),
            }),
            h('span', null, t('verifyAfter')))) : null,
        state.compare ? h(CompareTable, { branches: group.branches, t }) : null,
        h('div', { className: 'bs-cards' },
          group.branches.map(branch => h(BranchCard, {
            key: branch.id,
            branch,
            t,
            busy: state.busy,
            onPromote: actions.promote,
            onDiff: actions.diff,
            onVerify: actions.verify,
            onCompare: () => actions.setCompare(true),
          }))))
    }

    /**
     * Main panel.
     * @param {object} props - injected close/translator/store.
     * @returns {object} element.
     */
    function Panel(props) {
      const { t, close, useStore } = props
      const state = useStore()
      const [now, setNow] = useState(Date.now())
      const selected = useMemo(
        () => state.groups.find(group => group.id === state.selectedId) ?? null,
        [state.groups, state.selectedId],
      )
      const running = state.groups.some(group => group.branches.some(branch => branch.status === 'preparing' || branch.status === 'queued' || branch.status === 'running'))

      const setState = useCallback(updater => store.set(updater), [])

      useEffect(() => {
        if (!state.open) return undefined
        const tick = () => {
          setNow(Date.now())
          void refresh()
        }
        tick()
        const timer = setInterval(tick, running ? 2500 : 12000)
        return () => clearInterval(timer)
      }, [state.open, state.sessionId, running])

      useEffect(() => {
        if (!state.open) return undefined
        const onKey = event => {
          if (event.key === 'Escape') {
            if (state.diff.open) setState(current => ({ ...current, diff: { ...current.diff, open: false } }))
            else close()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [state.open, state.diff.open, close, setState])

      if (!state.open) return null

      const actions = {
        refresh,
        setCompare: value => setState(current => ({ ...current, compare: value })),
        setVerifyAfter: value => setState(current => ({ ...current, verifyAfter: value })),
        promote: branchId => { void promoteBranch(branchId) },
        diff: branch => { void showDiff(branch) },
        verify: branchId => { void reVerify(branchId) },
        archive: groupId => { void archiveGroup(groupId, t('confirmArchive')) },
        select: groupId => setState(current => ({ ...current, selectedId: groupId, view: 'group', compare: false })),
        create: () => setState(current => ({ ...current, view: 'create', selectedId: null, compare: false })),
        setForm: patch => setState(current => ({ ...current, form: { ...current.form, ...patch } })),
      }

      const groups = state.groups

      return h(React.Fragment, null,
        h(Styles),
        h('div', { className: 'bs-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) close() } },
          h('section', { className: 'bs-panel', role: 'dialog', 'aria-label': t('title') },
            h('header', { className: 'bs-head' },
              h('div', { className: 'bs-headtitle' }, h(BranchIcon, { size: 18 }), h('strong', null, t('title'))),
              h('div', { className: 'bs-headmeta' },
                state.meta ? h('span', null, state.meta.cwd) : null,
                state.meta?.model ? h('span', { className: 'bs-modelchip' }, `${state.meta.model.provider}/${state.meta.model.model}`) : null),
              h('button', { type: 'button', className: 'bs-iconbtn', 'aria-label': t('cancel'), onClick: close }, '✕')),
            state.error ? h('div', { className: 'bs-error' }, `${t('errorPrefix')}: ${state.error}`) : null,
            state.banner ? h('div', { className: `bs-banner bs-banner-${state.banner.kind}` },
              h('div', null, state.banner.text),
              state.banner.detail ? h('pre', { className: 'bs-bannerdetail' }, state.banner.detail) : null) : null,
            h('div', { className: 'bs-body' },
              h('aside', { className: 'bs-side' },
                h('button', {
                  type: 'button',
                  className: `bs-newbtn ${state.view === 'create' ? 'bs-newbtn-active' : ''}`,
                  onClick: () => actions.create(),
                }, `+ ${t('newGroup')}`),
                h('div', { className: 'bs-sidelabel' }, t('history')),
                groups.length === 0 ? h('div', { className: 'bs-empty' }, t('noGroups')) : null,
                groups.map(group => h('button', {
                  key: group.id,
                  type: 'button',
                  className: `bs-groupitem ${group.id === state.selectedId ? 'bs-groupitem-active' : ''}`,
                  onClick: () => actions.select(group.id),
                },
                h('div', { className: 'bs-groupitem-title', title: group.title }, group.title),
                h('div', { className: 'bs-groupitem-meta' },
                  h('span', null, group.mode === 'git' ? 'git' : 'copy'),
                  h('span', null, `${group.branches.length}`),
                  h('span', null, timeAgo(group.createdAt))),
                h('div', { className: 'bs-groupitem-dots' },
                  group.branches.map(branch => h('i', { key: branch.id, className: `bs-dot bs-dot-${branch.status}`, title: `${branch.label}: ${branch.status}` }))))),
                h('div', { className: 'bs-sidefoot' }, h('button', { type: 'button', className: 'bs-link', onClick: () => refresh() }, t('refresh')))),
              h('main', { className: 'bs-main' },
                state.loading ? h('div', { className: 'bs-empty' }, t('loading')) : null,
                state.view === 'create' || !selected
                  ? h(CreateView, { state, setState, onCreate: () => { void createGroup() }, t })
                  : h(GroupView, { group: selected, state, actions, t }))),
            state.diff.open ? h('div', { className: 'bs-diffbackdrop', onMouseDown: event => { if (event.target === event.currentTarget) setState(current => ({ ...current, diff: { ...current.diff, open: false } })) } },
              h('div', { className: 'bs-diffpanel' },
                h('header', { className: 'bs-diffhead' },
                  h('strong', null, state.diff.title),
                  h('button', { type: 'button', className: 'bs-iconbtn', onClick: () => setState(current => ({ ...current, diff: { ...current.diff, open: false } })) }, '✕')),
                state.diff.loading
                  ? h('div', { className: 'bs-empty' }, t('loading'))
                  : h('pre', { className: 'bs-diffpre' }, state.diff.text || t('emptyDiff')))) : null)))
    }

    // ------------------------------------------------------------------ shape

    const CSS = [
      '.bs-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));',
      'border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:12px;cursor:pointer}',
      '.bs-trigger:hover{color:var(--dsw-alias-label-primary,#161616);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04))}',
      '.bs-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}',
      '.bs-backdrop{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:22px;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48))}',
      '.bs-panel{width:min(1180px,96vw);height:min(840px,90vh);display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff);',
      'color:var(--dsw-alias-label-primary,#161616);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.28);font-size:13px}',
      '.bs-panel,.bs-panel *{box-sizing:border-box}',
      '.bs-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09))}',
      '.bs-headtitle{display:flex;align-items:center;gap:8px;font-size:14px}',
      '.bs-headmeta{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;max-width:52%;overflow:hidden}',
      '.bs-headmeta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bs-modelchip{padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06))}',
      '.bs-iconbtn{border:0;background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;padding:6px 8px;border-radius:8px}',
      '.bs-iconbtn:hover{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06))}',
      '.bs-body{flex:1;display:flex;min-height:0}',
      '.bs-side{width:250px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09));padding:12px;display:flex;flex-direction:column;gap:8px;overflow:auto;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.015))}',
      '.bs-newbtn{height:32px;border-radius:9px;border:1px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.2));background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.bs-newbtn-active{border-style:solid;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff);border-color:transparent}',
      '.bs-sidelabel{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:6px}',
      '.bs-groupitem{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;font:inherit;padding:8px;border-radius:9px;cursor:pointer}',
      '.bs-groupitem:hover{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05))}',
      '.bs-groupitem-active{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 1px 2px rgba(0,0,0,.05)}',
      '.bs-groupitem-title{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bs-groupitem-meta{display:flex;gap:8px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;margin-top:3px}',
      '.bs-groupitem-dots{display:flex;gap:4px;margin-top:6px}',
      '.bs-dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--dsw-alias-label-tertiary,#cbd5e1)}',
      '.bs-dot-running{background:#3b82f6}.bs-dot-queued{background:#8b5cf6}.bs-dot-completed{background:#22c55e}.bs-dot-error{background:#ef4444}.bs-dot-preparing{background:#f59e0b}.bs-dot-interrupted{background:#94a3b8}',
      '.bs-sidefoot{margin-top:auto;padding-top:8px}',
      '.bs-main{flex:1;min-width:0;overflow:auto;padding:16px 18px}',
      '.bs-sectionhead{display:flex;align-items:baseline;gap:10px;margin:2px 0 10px}',
      '.bs-sectionhead h3,.bs-sectionhead h4{margin:0;font-size:14px}',
      '.bs-cwd{margin-left:auto;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bs-field{display:flex;flex-direction:column;gap:5px;margin-bottom:11px}',
      '.bs-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);font-weight:600}',
      '.bs-input,.bs-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;padding:7px 9px;outline:none}',
      '.bs-input:focus,.bs-textarea:focus{border-color:var(--dsw-alias-link,#4d6bfe);box-shadow:0 0 0 2px rgba(77,107,254,.15)}',
      '.bs-textarea{resize:vertical;min-height:56px;line-height:1.45}',
      '.bs-input::placeholder,.bs-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#9aa1ab);opacity:1}',
      '.bs-panel input[type="checkbox"]{accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.bs-row2{display:grid;grid-template-columns:1.4fr 1fr;gap:12px}',
      '.bs-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);line-height:1.4}',
      '.bs-progress{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.bs-progressbar{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.08));overflow:hidden}',
      '.bs-progressfill{height:100%;background:var(--dsw-alias-trajectory-accent,#2563eb);border-radius:999px;transition:width .4s ease}',
      '.bs-check{display:flex;align-items:center;gap:8px;margin:2px 0 8px;font-size:12.5px;flex-wrap:wrap}',
      '.bs-check .bs-hint{flex-basis:100%;margin-left:22px}',
      '.bs-modehint{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);margin:2px 0 14px}',
      '.bs-modebadge{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06))}',
      '.bs-brancheshead{margin-top:6px}',
      '.bs-branchform{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:10px;padding:10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.015))}',
      '.bs-branchform-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.bs-badge{width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.08));font-size:11px;font-weight:700;flex:none}',
      '.bs-labelinput{max-width:180px}',
      '.bs-modelsum{margin-left:auto;margin-right:auto;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}',
      '.bs-angle{min-height:44px;margin-bottom:4px}',
      '.bs-advanced{font-size:11.5px}',
      '.bs-modelrow{display:grid;grid-template-columns:1fr 1fr .7fr;gap:8px;margin-top:6px}',
      '.bs-effort{max-width:100%}',
      '.bs-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}',
      '.bs-primary{height:32px;padding:0 16px;border:0;border-radius:9px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff);font:inherit;font-weight:600;cursor:pointer}',
      '.bs-primary:disabled{opacity:.45;cursor:not-allowed}',
      '.bs-link{border:0;background:transparent;color:var(--dsw-alias-link,#4d6bfe);font:inherit;font-size:12px;cursor:pointer;padding:4px 6px;border-radius:6px}',
      '.bs-link:hover{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05))}',
      '.bs-danger{color:#dc2626}',
      '.bs-grouphead{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}',
      '.bs-grouphead h3{margin:0 0 4px;font-size:15px}',
      '.bs-groupline{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px}',
      '.bs-groupactions{margin-left:auto;display:flex;gap:2px}',
      '.bs-runningdot{color:var(--dsw-alias-trajectory-accent,#2563eb)}',
      '.bs-verifyline{margin:0 0 10px;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));font-size:11.5px}',
      '.bs-verifyline code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.bs-verifytoggle{margin-left:10px;font-size:11.5px}',
      '.bs-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}',
      '.bs-card{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:11px;padding:11px;background:var(--dsw-alias-bg-base,#fff);display:flex;flex-direction:column;gap:7px;min-width:0}',
      '.bs-cardhead{display:flex;flex-direction:column;gap:5px}',
      '.bs-cardtitle{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.bs-cardmeta{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}',
      '.bs-pill{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:600}',
      '.bs-pill-preparing{background:#fef3c7;color:#92400e}.bs-pill-queued{background:#ede9fe;color:#5b21b6}.bs-pill-running{background:#dbeafe;color:#1d4ed8}',
      '.bs-pill-completed{background:#dcfce7;color:#166534}.bs-pill-error{background:#fee2e2;color:#991b1b}',
      '.bs-pill-interrupted{background:#e5e7eb;color:#475569}',
      '.bs-answer{white-space:pre-wrap;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2937);cursor:pointer;border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}',
      '.bs-answer-clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}',
      '.bs-answer-small{-webkit-line-clamp:8;font-size:11.5px}',
      '.bs-cardactions{display:flex;align-items:center;gap:4px;margin-top:auto;padding-top:4px}',
      '.bs-promote{margin-left:auto}',
      '.bs-warnpill{background:#fef3c7;color:#92400e;font-size:10.5px;padding:1px 6px;border-radius:999px}',
      '.bs-ok{color:var(--dsw-alias-state-success-primary,#15803d)}.bs-bad{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.bs-warning{color:var(--dsw-alias-state-warn-primary,#b45309)}',
      '.bs-errorline{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:12px}',
      '.bs-empty{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;padding:14px 4px}',
      '.bs-error{margin:8px 16px 0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 12%,transparent);color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:12px}',
      '.bs-banner{margin:8px 16px 0;padding:8px 10px;border-radius:8px;font-size:12px}',
      '.bs-banner-ok{background:#dcfce7;color:#14532d}.bs-banner-warn{background:#fef3c7;color:#78350f}.bs-banner-bad{background:#fee2e2;color:#7f1d1d}',
      '.bs-bannerdetail{margin:6px 0 0;font-size:11px;white-space:pre-wrap;max-height:140px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.bs-compare{overflow:auto;margin-bottom:12px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:10px}',
      '.bs-compare table{border-collapse:collapse;width:100%;font-size:12px}',
      '.bs-compare th,.bs-compare td{padding:7px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));text-align:left;vertical-align:top}',
      '.bs-compare thead th{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));font-size:11.5px}',
      '.bs-compare tbody th{color:var(--dsw-alias-label-secondary,#6b7280);font-weight:600;white-space:nowrap}',
      '.bs-compare-answers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;padding:9px}',
      '.bs-compare-answerhead{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px}',
      '.bs-diffbackdrop{position:absolute;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:3}',
      '.bs-diffpanel{width:min(900px,94%);height:min(600px,88%);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12))}',
      '.bs-diffhead{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09))}',
      '.bs-diffpre{flex:1;overflow:auto;margin:0;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap}',
      '.bs-panel{position:relative}',
      '@media (max-width:900px){.bs-side{width:190px}.bs-row2{grid-template-columns:1fr}.bs-modelrow{grid-template-columns:1fr 1fr}.bs-backdrop{padding:8px}.bs-panel{height:94vh}}',
      '@media (max-width:680px){.bs-body{flex-direction:column}.bs-side{width:100%;max-height:150px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09))}}',
      'body[data-ds-dark-theme] .bs-pill-preparing{background:rgba(245,158,11,.16);color:#fbbf24}',
      'body[data-ds-dark-theme] .bs-pill-queued{background:rgba(139,92,246,.18);color:#c4b5fd}',
      'body[data-ds-dark-theme] .bs-pill-running{background:rgba(59,130,246,.18);color:#93c5fd}',
      'body[data-ds-dark-theme] .bs-pill-completed{background:rgba(34,197,94,.16);color:#86efac}',
      'body[data-ds-dark-theme] .bs-pill-error{background:rgba(239,68,68,.18);color:#fca5a5}',
      'body[data-ds-dark-theme] .bs-pill-interrupted{background:rgba(148,163,184,.18);color:#cbd5e1}',
      'body[data-ds-dark-theme] .bs-banner-ok{background:rgba(34,197,94,.14);color:#86efac}',
      'body[data-ds-dark-theme] .bs-banner-warn{background:rgba(245,158,11,.16);color:#fbbf24}',
      'body[data-ds-dark-theme] .bs-banner-bad{background:rgba(239,68,68,.16);color:#fca5a5}',
      'body[data-ds-dark-theme] .bs-warnpill{background:rgba(245,158,11,.16);color:#fbbf24}',
      'body[data-ds-dark-theme] .bs-error{background:rgba(239,68,68,.16);color:#fca5a5}',
    ].join('')

    // ------------------------------------------------------------------ entry

    /**
     * Browser plugin body.
     * @param {object} ctx - client context.
     * @returns {void}
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'branch-studio: dictionaries')
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'branch-studio.trigger',
        order: 44,
        inject: () => ({
          t,
          open: sessionId => store.set(current => ({
            ...current,
            open: true,
            sessionId: sessionId ?? null,
            view: 'create',
            selectedId: null,
            compare: false,
            banner: null,
            error: null,
            diff: { open: false, title: '', text: '', loading: false },
          })),
        }),
      }, Trigger))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'branch-studio.panel',
        order: 36,
        inject: () => ({
          t,
          close: () => store.set(current => ({ ...current, open: false, diff: { ...current.diff, open: false } })),
          useStore: store.use,
        }),
      }, Panel))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
