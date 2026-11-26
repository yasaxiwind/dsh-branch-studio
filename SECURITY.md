# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Advisories → Report a vulnerability) for this repository. Do not open a public issue for a bypass of the path checks, cross-session access, or a branch escaping its workspace.

Include:

- the plugin version and DSH version;
- a minimal reproduction (commands, branch/group ids, state excerpt);
- whether the issue requires a malicious branch agent or a malicious local state file.

## Trust model (short version)

**branch studio is not a sandbox.** Branch agents are subagents with the same tools and permissions as the calling conversation; they can read/write absolute paths and use the network if the session allows it. Isolation only guarantees that branch file changes are not applied to the real workspace until an explicit promote.

See [docs/SECURITY.md](docs/SECURITY.md) for the full boundary, capabilities, and hardening checklist.
