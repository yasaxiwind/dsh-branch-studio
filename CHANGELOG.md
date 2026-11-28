# Changelog

## 0.2.1 (2026-11-28)

- Live activity now shows the meaningful argument (command, file path, pattern) instead of the raw JSON string.
- The activity line ellipsizes cleanly inside a narrow branch card.

## 0.2.0 (2026-11-28)

### Features

- **Live activity**: while a branch runs, its card shows the latest tool call or answering step.
- **Settings panel**: the gear in the header edits the large-directory warning, the subagent-slot wait, dependency sharing and the default post-promotion verification. Values are saved under `~/.dsh/branch-studio/settings.json`; explicit profile config still wins and is shown as locked.
- **Detail preview**: the Plugin Manager detail page now has a feature illustration and descriptions in English and Chinese.
- **Answer controls**: compare answers can be expanded and copied; each branch card can copy its answer; the diff viewer can copy the full diff.
- **English README**: `README.en.md`.

## 0.1.2 (2026-11-27)

Documentation-only release. No runtime behavior changed.

- README install command no longer pins an old version; it now follows `latest`.
- `RELEASE.md` install example updated the same way.

## 0.1.1 (2026-11-27)

Documentation-only release. No runtime behavior changed.

- Removed internal QA notes (`COMPETITORS`, `GUI-TEST`, `GUI-RECHECK`, `VERIFICATION`) from the repository and the npm package.
- README now links only to the public security model.
- `RELEASE.md` is no longer shipped in the npm package.
- `verify:package` now rejects the internal documents if they reappear.

## 0.1.0 (2026-11-26)

First public version.

### Features

- **Real conversation fork**: branches start from the completed turns of the current session (`fork` provider) or from a clean context (`spawn`), each with its own prompt and optional provider/model override.
- **Isolated workspaces**: git repositories use a `git worktree` per branch; non-git directories use a bounded copy (`node_modules` / `.venv` can be shared through junctions or symlinks).
- **Compare before promoting**: answers, changed files, verification result, billed tokens and duration are collected per branch and shown in a side-by-side table.
- **Promote with verification and rollback**: promotion writes into the real workspace only on explicit action; the group verification command runs again after applying and failed verifications restore the touched files from byte backups.
- **Progress and limits**: copy preparation reports bytes/files and percentage; a non-git workspace over `copyWarnMB` requires explicit confirmation; `maxCopyMB` / `maxCopyFiles` are hard limits.
- **Capacity-aware**: when the subagent tree is full (`maxActiveSubagents`), branches wait in `queued` instead of failing, then resume when a slot frees.
- **Per-branch cancel**: a preparing, queued or running branch can be cancelled on its own without touching sibling branches.
- **State hygiene**: archiving removes isolated workspaces; startup sweeps orphaned group/branch directories and stale base manifests; settled old groups are pruned by `keepGroups` / `keepDays`.
- **Security boundaries**: branch tools are restricted to the top-level conversation, routes are scoped by `sessionId`, archive validates workspace paths, and `linkDeps: false` disables shared dependency links. See `docs/SECURITY.md`.

### Known limits

- Not a sandbox: branch agents have the same tools and permissions as the parent session.
- Git mode relies on `git`; non-git mode copies the workspace and can be slow for large directories.
- Windows is exercised manually; Linux and macOS run the same test suite in CI.
- Promotion leaves changes uncommitted; the plugin never commits or pushes.
