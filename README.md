# Orca plugins

Personal plugins for Orca. Each plugin has its own manifest, source, tests and README
under `plugins/`.

| Plugin | Description |
| --- | --- |
| [Git Identity](plugins/git-identity/README.md) | Repository Git identity editing, gh account discovery and per-repo push-account binding. Windows prototype. |
| [MantisBT](plugins/mantisbt/README.md) | API token connection, project picker, read-only issues and inline details/comments. |
| [Asana](plugins/asana/README.md) | Personal access token connection, project picker, read-only tasks and inline details/comments. |
| [Agent Usage](plugins/agent-usage/README.md) | Per-account remaining allowance and reset times in one sidebar. |
| [Xcode Storage](plugins/xcode-storage/README.md) | Review Xcode DerivedData disk usage and delete selected cache folders on macOS. |

## Development

Run from the repository root:

```powershell
orca plugin dev load ./plugins/git-identity --json
orca plugin validate ./plugins/git-identity --json
orca plugin test ./plugins/git-identity --json
orca plugin check ./plugins/git-identity --json
```

Review the access report before approving a code plugin. No build step is needed:
Orca loads TypeScript and components directly. For type checking, generate types with
`orca plugin types ./plugins/git-identity --json`, then run
`tsc -p ./plugins/git-identity` with TypeScript installed.

Generated `.orca/` types and screenshots, tool caches and local secrets are ignored.
Only source, manifests, tests and documentation belong in Git. Nothing is published
or installed automatically from this repository.
