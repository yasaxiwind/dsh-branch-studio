# Release notes and checklist

This repository is prepared for the `0.1.0` source release. **No npm, marketplace, mirror or GitHub Release publication has been performed yet.** The steps below are the manual checklist for a later release.

## 0.1.0 checklist

- [x] `package.json` version `0.1.0`
- [x] `CHANGELOG.md` entry for 0.1.0
- [x] `VERIFICATION.md` (in `docs/`) and GUI test record
- [x] `npm test` (host / git / queue / maintenance / security / client) green on Windows
- [x] `npm run verify:package` passes and `npm pack --dry-run` contains only expected files
- [x] GitHub Actions test workflow for Windows / Ubuntu / macOS
- [x] First CI run green after the repository is pushed (run 45839849687, all three platforms)
- [x] Tag `v0.1.0` + GitHub Release with the npm tarball (`v0.1.0`, 2026-11-27)
- [x] npm publish `dsh-branch-studio@0.1.0` (shasum `267b36267316be88ff0e7d6b5d95edea5d162e9c`)
- [x] npm install smoke in a fresh directory (`dsh-branch-studio@0.1.0`, host `apply` loads, 17 files)
- [ ] Clean DSH profile install: `dsh` CLI is not available in this environment; use a separate profile when a CLI is available
- [ ] Optional: awesome-dsh-plugin entry (repository must be >1 day old)

## Install from source (before any npm release)

```sh
dsh plugin add https://github.com/yasaxiwind/dsh-branch-studio
```

or, in a local checkout:

```sh
dsh plugin add <path-to-dsh-branch-studio>
```

## Verification commands

```sh
npm run release:check
npm pack --dry-run
```

Do not commit `dist-release/`, `*.tgz`, `scratch/` or local screenshots.
