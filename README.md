# Orca plugins

Personal plugins for Orca. Each plugin has its own manifest, source, tests and README
under `plugins/`.

| Plugin | Description |
| --- | --- |
| [Agent Accounts](plugins/agent-accounts/README.md) | Codex/Claude CLI accounts plus a Pi Chat shortcut, launched from Orca's status bar. Windows prototype. |
| [Git Identity](plugins/git-identity/README.md) | Repository Git identity in the status bar, gh account discovery, local author editing and per-repo push-account binding. Windows prototype. |
| [MantisBT](plugins/mantisbt/README.md) | API token connection, project picker, read-only issues and inline details/comments. |
| [Asana](plugins/asana/README.md) | Personal access token connection, project picker, read-only tasks and inline details/comments. |

## Development

Run from the repository root:

```powershell
orca plugin dev load ./plugins/agent-accounts --json
orca plugin validate ./plugins/agent-accounts --json
orca plugin test ./plugins/agent-accounts --json
orca plugin check ./plugins/agent-accounts --json
```

Review the access report before approving a code plugin. No build step is needed:
Orca loads TypeScript and components directly. For type checking, generate types with
`orca plugin types ./plugins/agent-accounts --json`, then run
`tsc -p ./plugins/agent-accounts` with TypeScript installed.

Generated `.orca/` types and screenshots, tool caches and local secrets are ignored.
Only source, manifests, tests and documentation belong in Git. Nothing is published
or installed automatically from this repository.

The folder was previously `plugins/codex-accounts`. Agent Accounts keeps its original
internal plugin/panel IDs so existing Orca storage and sidebar references continue to
work. Orca still requires approval for the new development-folder path, even though the
requested capabilities are unchanged. See the plugin README for compatibility details.
