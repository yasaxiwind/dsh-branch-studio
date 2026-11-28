# Release history

## 0.2.1 (2026-11-28)

- npm: [`dsh-branch-studio@0.2.1`](https://www.npmjs.com/package/dsh-branch-studio/v/0.2.1)
- Live-activity text now shows the parsed command/path instead of raw JSON; layout ellipsizes cleanly.
- GitHub Release: [v0.2.1](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.2.1)

## 0.2.0 (2026-11-28)

- npm: [`dsh-branch-studio@0.2.0`](https://www.npmjs.com/package/dsh-branch-studio/v/0.2.0)
- Live branch activity, settings panel, detail-page preview, answer/diff copy controls and an English README.
- GitHub Release: [v0.2.0](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.2.0)

## 0.1.2 (2026-11-27)

- npm: [`dsh-branch-studio@0.1.2`](https://www.npmjs.com/package/dsh-branch-studio/v/0.1.2)
- Documentation-only release: install command no longer pins an old version.
- GitHub Release: [v0.1.2](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.1.2)

## 0.1.1 (2026-11-27)

- npm: [`dsh-branch-studio@0.1.1`](https://www.npmjs.com/package/dsh-branch-studio/v/0.1.1)
- Documentation-only release: internal QA notes removed from the package; runtime unchanged.
- GitHub Release: [v0.1.1](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.1.1)

## 0.1.0 (2026-11-27)

- npm: [`dsh-branch-studio@0.1.0`](https://www.npmjs.com/package/dsh-branch-studio/v/0.1.0)
- GitHub Release: [v0.1.0](https://github.com/yasaxiwind/dsh-branch-studio/releases/tag/v0.1.0)
- tarball SHA-1: `267b36267316be88ff0e7d6b5d95edea5d162e9c`
- Three-platform CI (Windows / Ubuntu / macOS): green
- npm install smoke in a fresh directory: passed

## Install

```sh
dsh plugin add dsh-branch-studio
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
