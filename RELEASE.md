# Release history

## 0.1.0 (2026-11-27)

- npm: [`dsh-branch-studio@0.1.0`](https://www.npmjs.com/package/dsh-branch-studio/v/0.1.0)
- GitHub Release: [v0.1.0](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.1.0)
- tarball SHA-1: `267b36267316be88ff0e7d6b5d95edea5d162e9c`
- Three-platform CI (Windows / Ubuntu / macOS): green
- npm install smoke in a fresh directory: passed

## Install

```sh
dsh plugin add dsh-branch-studio@0.1.0
```

From source:

```sh
dsh plugin add https://github.com/yasaxiwind/dsh-branch-studio
```

## Maintainer verification

```sh
npm run release:check
npm pack --dry-run
```

Do not commit `dist-release/`, `*.tgz`, `scratch/` or local screenshots.
