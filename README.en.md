# dsh-branch-studio

[![test](https://github.com/yasaxiwind/dsh-branch-studio/actions/workflows/test.yml/badge.svg)](https://github.com/yasaxiwind/dsh-branch-studio/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/dsh-branch-studio.svg)](https://www.npmjs.com/package/dsh-branch-studio)

Fan the current DeepSeek Harness conversation out into 2–4 isolated branches, run each one with its own angle, model and prompt, compare answers, file changes and verification results, then promote the winner back into the real workspace. If the post-promotion verification fails, the touched files are restored.

This is **future branching, not history rollback**: it never truncates the conversation or deletes anything. It runs several possible next steps in parallel and writes only the one you choose.

## How it differs from a session tree

Most branch plugins stay at the conversation layer: show a tree, jump, copy history or mark a decision. Only a few touch the filesystem, and fewer still close the loop from compare to verified write-back. `dsh-agent-compare` is close, but it creates a new session with a copied prefix instead of a real fork of the current conversation, and it has no post-promotion verification with automatic rollback.

| Capability | Session-tree plugins | dsh-agent-compare | **branch-studio** |
|---|---|---|---|
| Real fork of the current conversation | ✅ | ⚠️ copied turns | ✅ `fork` provider inherits completed turns |
| Isolated workspace per branch | ❌ | ✅ git worktree | ✅ git worktree **or** directory copy |
| Parallel runs, per-branch model | ❌ / partial | ✅ | ✅ |
| Per-branch token budget | ❌ | ❌ | ✅ billed tokens, interrupted at the limit |
| Branch verification command | ❌ | ✅ | ✅ |
| Post-promotion re-verify + rollback | ❌ | ❌ | ✅ |
| Result summary injected into the source conversation | ❌ | ⚠️ | ✅ |
| Works outside git repositories | ❌ | ❌ | ✅ |

## Install

```sh
dsh plugin add dsh-branch-studio
```

Or **Settings → Plugins → + Add plugin** and search for `dsh-branch-studio`.

Requirements: DSH `>= 0.2.2-rc.5`; `git` on `PATH` for the git-worktree mode (not required for directory-copy mode).

## Usage

1. Click **Branches** on the left of the composer.
2. Enter the shared goal, optionally a verification command (a shell command, e.g. `npm test`) and a per-branch token budget.
3. Write each branch's angle (for example "smallest diff" or "rewrite the architecture") and optionally override its provider/model.
4. Start the exploration. The panel refreshes every 2–3 seconds and shows the latest tool activity while a branch runs.
5. When done: compare answers side by side, inspect the diff, copy the answer, cancel a single running branch, then promote one branch. Promotion re-runs the verification command in the real workspace when configured; a failure restores the touched files.
6. **Archive** removes the group and its isolated workspaces.

## Settings

The gear in the panel header opens settings:

- large-directory copy warning threshold;
- maximum wait for a subagent slot;
- share dependency directories (`node_modules` / `.venv`);
- whether promotion re-verifies by default.

Settings apply to new explorations and promotions. A value set explicitly in the profile's plugin config wins and is shown as locked.

## Platforms

| Platform | Status |
|---|---|
| Windows 10/11 | ✅ |
| Linux | ✅ |
| macOS | ✅ |

`package.json` has no `os` field. All three platforms are covered by CI.

## Known limits

- A branch is a full child agent, so it uses the same tools and permissions as the parent. This is isolation of files, not a security sandbox.
- Forked children inherit the completed-turn prefix only, not the in-flight turn.
- Verification commands run with your user permissions; enter only commands you trust.
- The directory-copy mode has size/file-count limits; prefer a git repository for large workspaces.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the trust model.

## License

MIT
