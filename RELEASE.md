# Release notes and checklist

This repository is prepared for the `0.1.0` source release. **No npm, marketplace, mirror or GitHub Release publication has been performed yet.** The steps below are the manual checklist for a later release.

## 0.1.0 checklist

- [x] `package.json` version `0.1.0`
- [x] `CHANGELOG.md` entry for 0.1.0
- [x] `VERIFICATION.md` (in `docs/`) and GUI test record
- [x] `npm test` (host / git / queue / maintenance / security / client) green on Windows
- [x] `npm run verify:package` passes and `npm pack --dry-run` contains only expected files
- [x] GitHub Actions test workflow for Windows / Ubuntu / macOS
- [ ] First CI run green after the repository is pushed
- [ ] Optional: tag `v0.1.0` and GitHub Release with the npm tarball
- [ ] Optional: npm publish `dsh-branch-studio@0.1.0`
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
