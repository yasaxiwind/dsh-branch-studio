# Changelog

## 0.1.0 (2026-11-26)

First public version.

### Features

- **Real conversation fork**: branches start from the completed turns of the current session (`fork` provider) or from a clean context (`spawn`), each with its own prompt and optional provider/model override.
- **Isolated workspaces**: git repositories use a `git worktree` per branch; non-git directories use a bounded copy (`node_modules` / `.venv` can be shared through junctions or symlinks).
- **Compare before promoting**: answers, changed files, verification result, billed tokens and duration are collected per branch and shown in a side-by-side table.
- **Promote with verification and rollback**: promotion writes into the real workspace only on explicit action; the group verification command runs again after applying and failed verifications restore the touched files from byte backups.
- **Progress and limits**: copy preparation reports bytes/files and percentage; a non-git workspace over `copyWarnMB` requires explicit confirmation; `maxCopyMB` / `maxCopyFiles` are hard limits.
- **Capacity-aware**: when the subagent tree is full (`maxActiveSubagents`), branches wait in `queued` instead of failing, then resume when a slot frees.
- **State hygiene**: archiving removes isolated workspaces; startup sweeps orphaned group/branch directories and stale base manifests; settled old groups are pruned by `keepGroups` / `keepDays`.
- **Security boundaries**: branch tools are restricted to the top-level conversation, routes are scoped by `sessionId`, archive validates workspace paths, and `linkDeps: false` disables shared dependency links. See `docs/SECURITY.md`.

### Known limits

- Not a sandbox: branch agents have the same tools and permissions as the parent session.
- Git mode relies on `git`; non-git mode copies the workspace and can be slow for large directories.
- Windows is exercised manually; Linux and macOS run the same test suite in CI.
- Promotion leaves changes uncommitted; the plugin never commits or pushes.
