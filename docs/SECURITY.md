# 安全边界与信任模型

> 一句话：**branch studio 不是沙箱。** 分支是拥有你同等工具和权限的子代理；隔离只保证"改动不会自动进入真实工作区"，不保证"分支不能碰你的文件"。

## 1. 这个插件能做什么（能力声明）

| 能力 | 是否使用 | 说明 |
|---|---|---|
| 读文件 | ✅ | 扫描工作区、读 manifest、读分支产物 |
| 写文件 | ✅ | 分支工作区、`.dsh-branch-studio/`、提升时写真实工作区、`.git/info/exclude` |
| 执行命令 | ✅ | `git`、Windows `robocopy`、POSIX `fs.cp`；**以及你填的验证命令**（`cmd.exe` / `sh -c`） |
| 启动子代理 | ✅ | `fork` / `spawn`，每个分支一个，受 `maxActiveSubagents` 限制 |
| 网络 | ❌ | 插件本身不发起网络请求；分支里的模型调用由 DSH 提供 |
| 遥测 | ❌ | 无 |

## 2. 隔离的是什么，不是什么

| 维度 | 隔离 | 说明 |
|---|---|---|
| 文件改动 | ✅ 到 promote 为止 | 每个分支有自己的 worktree / 目录副本；提升前不碰真实工作区 |
| 进程 / 环境变量 | ❌ | 分支子代理与主会话拥有同样的进程权限和环境 |
| 绝对路径 | ❌ | 分支里的 shell/文件工具可以访问工作区以外的任何路径 |
| 网络 | ❌ | 分支可以访问网络（取决于 DSH 工具与权限） |
| `.git` 仓库 | ⚠️ 共享 | git worktree 共享对象库和 refs；分支可以运行 git 命令修改仓库 |
| `node_modules` / `.venv` | ⚠️ 共享 | 默认用 junction/symlink 链接到父目录；分支**可写**，可影响真实依赖；`linkDeps: false` 可关闭 |
| 密钥 / `.env` | ❌ | 非 git 模式会复制整个工作区（排除依赖/构建目录），副本里可能含 `.env`、密钥 |

**结论：不要用这个插件运行不可信的模型、提示词或第三方代码。** 它适合"我信任这些 agent，只想让它们别互相踩文件"的场景。

## 3. 特权动作

### 3.1 验证命令（verify）

- 是**用户提供的任意 shell 命令**，在分支工作区里以你的用户权限运行；
- Windows 走 `cmd.exe /d /s /c <临时 .cmd>`，POSIX 走 `sh -c`；
- 有超时（`verifyTimeoutMs`，默认 180s）；
- 输出会存进 state 并在界面显示，可能包含敏感信息；
- **只填你信任的命令**，不要从不可信来源复制命令。界面上也有提示。

### 3.2 提升（promote）

- 会把分支改动写进**真实工作区**；git 模式用 `git apply`，copy 模式按文件回写；
- 写之前做冲突检查（copy 模式检查文件是否在分支运行期间被改过）；
- 填了验证命令且开启「提升后复验」时，会在真实工作区再跑一次，失败自动按字节备份回滚；
- **不会自动 commit**，也不会推送；
- 目标路径必须解析在会话工作区内（`inside(cwd, path)` 检查）。

### 3.3 归档（archive）

- 删除该组的隔离目录和 state 记录；未提升的改动会丢；
- 删除前校验 workspace 路径在 studio 根内；即使 state 被手工改坏，也不会删除工作区外的目录（`test/security-smoke.mjs` 覆盖）。

### 3.4 `.git/info/exclude`

- git 模式会在仓库的 `.git/info/exclude` 追加一行 `.dsh-branch-studio/`；
- 只追加这一行，不修改 `.gitignore`，不删除其他内容；
- 该目录不要提交；如果仓库已有同名规则也不会重复添加。

## 4. 授权模型

- **工具**：`branch_start` / `branch_list` / `branch_compare` / `branch_promote` / `branch_archive` 只对**顶层会话**开放；分支子代理调用会被拒绝（`branch tools are only available to the top-level conversation`），避免分支自己把自己提升。
- **工具参数**：promote/archive 只能操作**本会话**创建的组；跨会话 id 会被拒绝。
- **HTTP 路由**：promote / verify / diff / archive 都要求 `sessionId` 且与组归属匹配；create 使用 live session。路由依赖 DSH 的同源认证，**不是多租户隔离**。
- **state 文件**：`~/.dsh/branch-studio/state.json` 被视为可信本地文件；包含回答、diff、验证输出、工作区路径。请保护你的 profile 目录权限。

## 5. 提示注入

- 分支回答会作为"提升通知"注入回源对话（`agent.inject`），内容来自子代理；
- 子代理可能被恶意仓库内容/网页提示注入，产生针对主会话的指令；
- 提升通知是**数据**，不是用户指令；主会话应把它当作分支结果，而不是命令。
- 同理，分支的 `answer` 会显示在对比面板里，不要盲信。

## 6. 加固清单

- [ ] 只在你信任的仓库/提示词上运行；
- [ ] 验证命令只填自己写的命令；
- [ ] 不需要共享依赖时设 `linkDeps: false`（分支跑验证前需自己安装依赖）；
- [ ] 及时归档不需要的组，避免副本里残留 `.env` / 密钥；
- [ ] 不要把 `.dsh-branch-studio/` 提交进仓库；
- [ ] 非 git 大目录先确认体积（`copyWarnMB` / `maxCopyMB`）；
- [ ] 重要提升前先看 `git status`，提升后确认再 commit；
- [ ] 保护 `~/.dsh`（state 含分支回答和路径）。

## 7. 已知限制

- 不是多租户隔离：同一 DSH 用户/进程内的其他插件理论上可以读取 state 或调用路由；
- 分支 agent 拥有与主会话相同的工具权限，绝对路径/网络/环境变量均不受限；
- 路径校验只保护 promote/archive 的写入/删除目标，不限制分支自身的操作；
- 复制模式会完整复制工作区（排除依赖/构建目录），敏感文件也会进副本；
- 归档/保留策略会删除副本；自动清理只针对"超过 `keepGroups` 且结束超过 `keepDays`"的旧组，但仍可能删掉未提升的旧改动——重要结果先 promote。

## 8. 报告问题

发现绕过路径校验、跨会话操作或权限提升，请附上最小复现（命令、state 片段、分支 workspace 路径）提交 issue。
