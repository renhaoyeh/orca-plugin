# Agent Accounts

Codex and Claude accounts, plus a Pi Chat shortcut, in one Orca sidebar panel and status bar.
Windows prototype; requires Orca 1.4.248+ and the corresponding CLIs installed on PATH.
Only local Windows workspaces are supported, not WSL, SSH or paired-server workspaces.

## Use

1. Load this development folder from the repository root:
   `orca plugin dev load ./plugins/agent-accounts --json`.
2. Review Orca's access report and approve its returned fingerprint if required.
3. Open **Agent Accounts** in Orca's right sidebar.
4. Add the entries you want:
   - **Add Codex / Add Claude** opens the official `orca account add --agent <provider>`
     sign-in flow in a terminal. Complete sign-in yourself, then click **Refresh**.
   - **Add Pi** saves a launcher immediately. It does not start Pi or sign in.
5. Click an entry in the bottom status bar: Codex/Claude open CLI terminals; Pi opens
   Orca's native Chat UI in the current workspace.

The plugin never changes Orca's selected account. No agents or sign-ins start automatically.
While any agent or sign-in terminal is opening, repeated status-bar clicks and launch
requests are ignored, not queued or reported as failures. Once creation succeeds or
fails, a new click is accepted. This protects Codex, Claude and Pi with one shared lock.
A launch click explicitly focuses the new terminal or Chat tab. The panel itself has no duplicate
launch buttons, API-key creation form or permissions-help block.

Use the pencil to rename an entry. Names are stored by account ID and do not change Orca's
account settings. Leave the name blank to restore its original label. **Remove Pi entry**
removes only the shortcut, not Pi's settings, credentials or existing tabs.

Orca permits eight status items per plugin. With Pi enabled, one slot is reserved for it
and up to seven managed/API accounts are shown. Overflow accounts remain in the panel
without a status-bar launch shortcut. Terminal title/status updates do not reload the list;
use **Refresh** after changing accounts.

## How launches work

| Entry | Discovery / setup | Launch |
| --- | --- | --- |
| Codex | `orca account list/add --agent codex` | `orca terminal create`, then Codex CLI with the selected `CODEX_HOME` |
| Claude | `orca account list/add --agent claude` | `orca terminal create`, then Claude CLI with the selected `CLAUDE_CONFIG_DIR` |
| Pi | A saved shortcut flag, not an Orca-managed provider account | `orca agent launch --agent pi --surface chat --focus` (native Chat UI) |

Codex and Claude use direct CLI startup, not an account-scoped Orca agent-launch API.
They bypass Orca's per-launch config/skills preparation. The plugin checks credential-file
readability (`auth.json` / `.credentials.json`) without reading or copying credentials.
Claude's home comes from Orca's account-list response. Accounts requiring sign-in, WSL
accounts and Claude accounts falling back to the system default are disabled rather than
silently launching another identity. Inherited Anthropic API credentials and alternate
cloud routing are cleared only in the Claude child process. The parent environment is
unchanged.

Pi explicitly requests Orca's native Chat UI, rather than the terminal CLI. Provider/model
configuration and authentication are handled by Orca/Pi, not this plugin. No Pi credentials
are read, imported or stored here; no initial prompt, model override or trust bypass is
supplied. Adding Pi works without a workspace; launching requires a local workspace.

If the installed Orca cannot open Pi as Chat, its explicit Chat request can be refused.
Orca can also fall back to a CLI terminal when support cannot be established or changes
during launch. The plugin checks the returned outcome and reports that fallback rather
than treating it as Chat success; it does not automatically create another session.

The CLIs handle their own folder-trust, hook-review and permission prompts. The plugin
never answers those prompts automatically. Launch errors are not retried automatically;
check existing tabs before retrying an unconfirmed launch to avoid duplicate agents.

## Language

The panel follows Orca's language: English, Traditional Chinese and Simplified Chinese;
other locales fall back to English. Reopen the panel after changing Orca's language.
Account names are never translated. External CLI errors keep their original text.

## Stored data and access

Runs as a `trusted-worker`, with normal user access on the local Orca host. The official
CLI subprocesses run outside plugin host capability enforcement. Declared capabilities:

- `workspace:read`: validate the current workspace and its host.
- `terminal:send`: create the explicitly requested terminals.
- `storage:own`: display names, locale, the Pi-enabled flag and legacy API metadata.
- `secrets:own`: compatibility with previously saved API profiles.

### Legacy OpenAI API profiles

The panel no longer creates API profiles. Previously saved ones remain readable, renameable
and removable; **Remove API profile** deletes the stored key and profile entry, not existing
terminals or session files. Pi keys should be managed by Pi instead.

Legacy profiles use paid OpenAI API billing, not ChatGPT subscription quota. Their keys stay
in Orca's encrypted secrets store, not metadata or launch arguments. A one-use local Windows
named pipe passes the key to the child PowerShell process; it closes after delivery or
60 seconds. The child uses a separate home and the OpenAI Responses provider. No key
validation or billable API request is made when saving legacy profiles through the worker.

### Stable identity and paths

The source folder and display name are now `agent-accounts` / **Agent Accounts**. The internal
plugin and panel IDs intentionally remain `codex-accounts`; the local plugin key therefore
remains `local.codex-accounts`. Changing these IDs would create a different Orca plugin and
strand its saved names, Pi flag, secrets and sidebar references. Moving this development
folder requires unloading the old path and loading the new one, not uninstalling. The new
folder path needs a fresh Orca approval even with unchanged capabilities.

Do not globally replace these other compatibility paths:

- `<Orca data>/codex-accounts/<id>/home` is owned by Orca, not this source folder.
- `<Orca data>/codex-accounts-plugin/api-homes/<id>` belongs to legacy API sessions.

## Development

From this plugin directory:

```powershell
orca plugin validate . --json
orca plugin test . --json
orca plugin check . --json
orca plugin types . --json
tsc -p .
```

No build step or bundled dependencies. TypeScript must be installed separately to run `tsc`.
Orca generates `.orca/types/`; `tsconfig.json` extends those generated types. `.orca/` files
are local tooling output, ignored by Git, and should not be edited. This is a native Orca
components panel, not a website: it does not use a frontend design-check cache.

| Source | Responsibility |
| --- | --- |
| `src/panel.tsx` | Sidebar controls and local form state |
| `src/worker.ts` | Request handlers, saved names, entries and status-bar commands |
| `src/protocol.ts` | Typed panel/worker requests |
| `src/accounts.mjs` | Managed-account discovery, login terminals and Codex/Claude shell commands |
| `src/pi.mjs` | Native Pi agent-launch CLI call |
| `src/api-profiles.mjs` | Legacy API-profile compatibility |
| `src/i18n.mjs` | Locale handling and translations |
| `src/*.test.*`, `src/panel.check.ts` | Mocked tests and panel-render scenarios |

Tests use fictional accounts, mocked APIs and temporary fake CLIs. They do not start real
agents, change real account selection, sign in, or make billable requests. Native panel and
status-bar screenshots can be captured with `orca plugin shot local.codex-accounts --json`;
scenario shots require Orca to already be hidden/minimized.

## Known limits

- Direct Codex/Claude launches do not guarantee Orca's native status tracking, per-tab account
  display, resume/restart behavior or usage attribution. The built-in account display can
  still show Orca's global selection, not the account in the plugin-launched terminal.
- The Codex/Claude terminal remains open after the CLI exits. Terminal creation is not proof
  that the agent successfully authenticated or started.
- Claude real-account sign-in/launch has not been end-to-end verified. Pi Chat creation
  was checked live through the plugin and returned a structured Chat outcome, without
  submitting a task. Model responses/authentication during a Pi task were not tested.
  Automated command-construction and routing tests use mocks/fake CLIs.
- Without worker environment overrides, this prototype assumes the standard per-user
  Windows Orca installation. Custom/portable installations are not supported by that fallback.
