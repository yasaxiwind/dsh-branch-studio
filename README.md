# dsh-branch-studio

[![test](https://github.com/yasaxiwind/dsh-branch-studio/actions/workflows/test.yml/badge.svg)](https://github.com/yasaxiwind/dsh-branch-studio/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/dsh-branch-studio.svg)](https://www.npmjs.com/package/dsh-branch-studio)

在 DeepSeek Harness 里做**并行分支探索**：从当前对话分叉出 2–4 条互相隔离的路线，各自用不同模型/提示去跑，最后对比回答、文件改动和验证结果，把胜出的那条**提升回真实工作区**；如果提升后验证失败，会自动回滚。

> 定位一句话：**它是"未来分叉"，不是"过去回滚"。** 不截断历史、不删除任何东西；只是把接下来的几种可能同时跑一遍，再选一条落地。

## 为什么不是又一个会话树

生态里与"分支"相关的插件大多停在**会话层**：看树、跳转、复制历史、标记决定。真正碰文件系统的只有少数，而"比较 → 验证 → 写回"能闭环的更少。最接近的 `dsh-agent-compare` 很强，但它**不是从真实对话历史分叉**（新建会话 + 复制 0/3 轮上下文），且没有"提升后在真实工作区复验、失败自动回滚"。

| 能力 | 会话树类插件 | dsh-agent-compare | **branch-studio** |
|---|---|---|---|
| 从当前对话**真实 fork**（继承完整历史） | ✅ | ⚠️ 复制部分轮次 | ✅ 用 `fork` provider 继承已完成轮次 |
| 每个分支独立工作区 | ❌ | ✅ git worktree | ✅ git worktree **或非 git 目录副本** |
| 并行 + 按分支选模型 | ❌ / 部分 | ✅ | ✅ |
| 分支级 token 预算 | ❌ | ❌ | ✅ 按计费 token 统计，超限自动中断 |
| 分支内验证命令 | ❌ | ✅ | ✅ |
| 提升后**复验 + 自动回滚** | ❌ | ❌（只在采用前预演） | ✅ |
| 把结果摘要注入源对话 | ❌ | ⚠️ | ✅ |
| 非 git 工作区可用 | ❌ | ❌（依赖 worktree） | ✅ |

## 安装

从 npm（推荐）：

```sh
dsh plugin add dsh-branch-studio
```

或 **Settings → Plugins → + Add plugin** 搜索 `dsh-branch-studio`。

从本地目录安装（开发时）：

1. **Settings → Plugins → + Add plugin**，选择本目录；或
2. CLI：`dsh plugin --profile <profile> add <本目录绝对路径>`

要求 DSH `>= 0.2.2-rc.5`，`git` 在 PATH 中（git 隔离模式需要；非 git 模式不强制）。

## 平台支持

| 平台 | 状态 | 说明 |
|---|---|---|
| Windows 10/11 | ✅ | 手工验收 + 三平台 CI；复制用 `robocopy`，依赖用 `mklink /J`，验证用 `cmd.exe` |
| Linux | ✅ | 同一套测试跑在 `ubuntu-latest`；复制用 `fs.cp`，依赖用 symlink，验证用 `sh -c` |
| macOS | ✅ | 同一套测试跑在 `macos-latest`；实现同 Linux |

`package.json` **不设置 `os` 字段**，三平台都可安装。三平台 CI 已全绿（2026-11-26）；遇到平台问题请开 issue。

**验证命令按平台写**：Windows 用 `findstr done note.txt`、`node verify.mjs`；Linux/macOS 用 `grep -q done note.txt`、`node verify.mjs`。验证命令是在分支工作区里跑的 shell 命令，不是自然语言。

## 使用

### 在界面里

对话输入框左侧会出现「分支」按钮：

1. 填**共同目标**（所有分支共享），可选填验证命令（例如 `npm test`）、每个分支的 token 上限。
2. 默认两条分支，可加到 4 条；每条可以写自己的"角度"（例如"最小改动" / "重写架构"），也可以给每条指定 provider/model。
3. 点「开始探索」。分支在后台准备并运行；面板每 2–3 秒刷新。
4. 跑完后：
   - **对比**：并排看状态、模型、耗时、tokens、改动文件数、验证结果和回答；
   - **改动**：查看该分支的 diff；
   - **提升**：把它的文件改动写回真实工作区（若填了验证命令，会在真实工作区再跑一次，失败自动回滚；也可以取消"提升后复验"）；
   - **清理**：删除该组分支和隔离目录。

> **验证字段是 shell 命令，不是问题。** 填 `npm test`、`node verify.mjs`、`findstr done note.txt` 这类命令；留空则不验证。把一句自然语言（例如"哪份报告更好"）填进去只会得到 shell 的"命令不存在"，分支仍会正常完成，但提升时若复验会失败并回滚——此时可取消"提升后复验"。

### 让 agent 自己用

模型可调用这些工具：

| 工具 | 作用 |
|---|---|
| `branch_start` | 开一组分支：`goal`、`branches[]`（`label`/`angle`/`provider`/`model`）、`verify`、`inherit`、`maxTokens` |
| `branch_list` | 列出本会话的分支组与状态 |
| `branch_compare` | 汇总一组分支的回答/文件/验证/tokens |
| `branch_promote` | 提升某个完成的分支（`applyDeletions`、`verifyAfter`） |
| `branch_cancel` | 取消某条准备中/排队中/运行中的分支，不影响其它分支 |
| `branch_archive` | 删除一组分支及其隔离目录 |

典型用法：

> 你：这个设置页太慢了，给我三个不同思路，跑完对比一下。
>
> agent：调用 `branch_start`（3 条分支：缓存、懒加载、重写查询）→ 完成后 `branch_compare` → 选一条 `branch_promote`。

## 两种隔离模式

- **git 仓库**：每个分支一个 `git worktree`（`<repo>/.dsh-branch-studio/<group>/<branch>`），工作区里未提交的改动会通过 patch 带进分支；提升时生成补丁并用 `git apply` 应用。不自动提交。
- **非 git 目录**：每个分支是会话目录的一份**副本**（默认排除 `node_modules`、`.git`、`dist`、`build`、缓存等；`node_modules`/`.venv` 会用 junction/symlink 共享，便于跑验证）。准备阶段会显示「复制中 x/y MB」进度；超过 `copyWarnMB` 需要在界面勾选确认，超过 `maxCopyMB` 直接拒绝。提升时按文件回写，写之前做冲突检查。

两种模式都会把隔离目录放进 `.git/info/exclude`（git）或隔离目录本身（非 git），避免污染 `git status`。

## 安全与边界

> 完整信任模型见 [docs/SECURITY.md](docs/SECURITY.md)。一句话：**这不是沙箱**；分支是拥有你同等权限的子代理，隔离只保证改动不会自动进入真实工作区。

- 分支工具（start/list/compare/promote/archive）只对**顶层会话**开放；分支子代理调用会被拒绝，promote/archive 还要求组属于本会话。
- 验证命令是任意 shell，以你的用户权限运行；只填你信任的命令。
- 复制模式默认 junction/symlink 共享 `node_modules`/`.venv`，分支可写；对不可信仓库设 `linkDeps: false`。
- 归档/清理前校验路径在 studio 根内；即使 state 被改坏也不会删除工作区外目录。
- 分支里的写入只发生在隔离目录；**只有「提升」会改真实工作区**。
- 提升前做冲突检查：如果工作区在分支运行期间改过同一个文件，就拒绝覆盖并列出来。
- 提升后复验失败会自动回滚（先备份补丁涉及的文件，失败时按文件字节恢复；不是反向补丁，避免 CRLF 归一化）。
- 清理会删除隔离目录；**未提升的分支改动会丢失**。
- 分支继承父会话的权限范围；它不会获得比父会话更大的权限。
- 分支和普通子代理**共享同一个 `maxActiveSubagents` 名额池**（默认 8，按 subagent tree 计）：名额满时分支进入「等待名额」状态，每 `capacityRetryMs` 重试，最多等 `capacityWaitMs`；仍无空位则该分支报错并提示"结束或归档其他智能体，或减少分支数"。
- 注意：已完成但仍驻留（可继续对话）的子代理**仍然占名额**；要释放名额，需要结束/归档它们。
- 非 git 模式会复制目录：默认上限 1536 MB / 60000 个文件（可配置），超过会拒绝并建议用 git 仓库。
- 避开大目录（`node_modules` 等）意味着某些项目第一次跑验证前需要自己装依赖；本插件会尝试链接父目录的 `node_modules`/`.venv`。

## 配置（`cordis.patch.yml`）

```yaml
- id: branch-studio
  name: 'dsh-branch-studio'
  config:
    maxBranches: 4            # 单组最多分支数
    maxCopyMB: 1536           # 非 git 模式复制的硬上限
    maxCopyFiles: 60000       # 非 git 模式复制的文件数上限
    copyWarnMB: 300           # 超过这个体积要求界面勾选「允许复制大目录」
    copyPollMs: 1000          # 复制进度刷新间隔
    keepGroups: 50            # 状态里最多保留多少组（超出且过期才会清理）
    keepDays: 14              # 超过这个天数且已结束的组才允许自动清理
    sweepGraceMs: 3600000     # 启动清扫时，未知组目录的宽限时间
    linkDeps: true            # 复制模式共享 node_modules/.venv；不需要时设 false
    verifyTimeoutMs: 180000   # 验证命令超时
    maxTokensPerBranch: 0     # 默认每分支 token 上限（0 = 关闭）
    budgetPollMs: 5000        # 预算检查间隔
    capacityWaitMs: 300000    # 名额满时最多等待多久
    capacityRetryMs: 3000     # 名额重试间隔
```

## 限制

- 分支从**当前已完成的轮次**分叉（`fork` provider 的语义）；当前正在执行的这一轮不会进入分支，所以分支提示词需要自包含。
- token 预算统计的是**计费 token**（未缓存输入 + 缓存读写 + 输出），`fork` 分支的第一次请求会包含继承的上下文，所以预算要给足余量（例如长对话里 20 万而不是 2 万）。
- `fork` 只继承对话历史，不继承父会话的临时权限；分支的 cwd 是隔离目录。
- git 模式依赖 `git`；非 git 模式在超大目录上会慢，建议在项目目录使用。
- **非 git 复制门禁**：工作区超过 `copyWarnMB`（默认 300 MB）时必须在界面勾选「允许复制大目录」，或调用 `branch_start` 时传 `confirmCopy: true`；超过 `maxCopyMB` 直接拒绝。准备阶段会显示「复制中 x/y MB」进度。
- **状态保留**：归档立即删除副本；启动时会清理没有对应状态的组/分支目录；超过 `keepGroups` 且结束超过 `keepDays` 的旧组会被自动清理（未提升的改动也会丢，重要结果请先 promote 或归档前自行保存）。
- 验证命令是用户提供的 shell 命令，请只填你信任的命令。
- 分支结果以 `fork`/`spawn` 子代理形式运行，受 `maxActiveSubagents`（默认 8）限制。

## 开发

```sh
npm test                     # host / git / queue / maintenance / security / client 六个烟测
npm run test:syntax          # node --check index.js && client.js
```

Host 半部：`index.js`（工具 + `/api/branch-studio/*` 路由 + 隔离/提升/回滚）。
Client 半部：`client.js`（输入框按钮 + 浮层面板，`window.__ModuleLoader__` 格式）。
三平台 CI：`.github/workflows/test.yml`（Windows / Ubuntu / macOS，Node 24）。

- 安全边界与信任模型：[docs/SECURITY.md](docs/SECURITY.md)

## License

MIT
