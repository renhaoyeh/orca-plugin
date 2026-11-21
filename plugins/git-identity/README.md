# Git Identity

A Windows Orca plugin for inspecting and editing a repository's commit author,
importing a public profile from a `gh` account, and explicitly saving an author or
push binding. Open the Git Identity panel from its command or panel entry.

## Development

From this repository root:

```powershell
orca plugin dev load ./plugins/git-identity --json
orca plugin test ./plugins/git-identity --json
orca plugin check ./plugins/git-identity --json
```

Review approval before enabling. Requires Orca 1.4.248+, Git 2.31+ and a recent GitHub
CLI on PATH, and a local Windows working tree. No npm dependencies or build step.
The UI is currently English. `orca plugin types . --json` generates `.orca/types/`
for optional checking with a separately installed TypeScript (`tsc -p .`).

## Usage

1. Open the Git Identity panel. The compact panel shows only the account picker and
   name/email fields. The repository caption, technical scope, config origin and full paths stay
   out of the normal UI. Switching workspaces refreshes the current repository;
   Refresh also reloads external config changes and `gh` accounts. No polling.
2. Select an available **GitHub account** discovered by `gh auth status`. Switching
   immediately sets this repository's default account; there is no extra Apply button.
   Opening/refreshing restores the stored selection without writing config again.
   Failed switches restore the prior selection. Its public profile then fills the
   author draft: missing public name falls back to login, and missing public email
   stays blank for manual entry. A failed profile read does not undo the account switch.
3. **Save** explicitly saves the name/email draft. Account switching does not
   automatically save author edits.
4. Choose **Default** in the account picker to use the previous Git settings again.
   There is no separate remove-binding button. Choose Default before uninstalling
   if you want this plugin's repository routing removed.

## Push routing (herdr-zed behavior)

The credential configuration follows `mods/herdr-zed-github/git-auth.js`: a host-specific
helper resets earlier helpers, answers only HTTPS `get` requests for the selected
host, clears ambient GitHub token overrides, and calls
`gh auth token --hostname <host> --user <login>` at credential-request time. `store` and
`erase` are ignored. Missing credentials fail closed. Tokens travel from gh to Git's
credential pipe, not through plugin state or Git config. `gh auth switch` is never run.

Unlike herdr-zed's per-command integration, a standalone plugin cannot inject flags
into Orca's Git implementation. These rules are therefore installed **only in the
repository's common Git config** (`.git/config`), affecting normal Git CLI operations
and all linked worktrees of this repo, not other projects or global gh selection.
The same host-specific authentication can also be used by fetch/pull, not just push.

The selected host gets two `url.https://<host>/.insteadOf` rules for `git@<host>:` and
`ssh://git@<host>/`, routing SSH-style URLs through HTTPS without modifying stored remote
URLs. A host-specific username is set alongside the helper. These are the same URL
forms supported by the original project; SSH host aliases and nonstandard ports are
not automatically converted. Existing local values for these exact keys are backed up
in `orca.githubbinding` in the same config, then restored on unbind or host change.
The backup can contain pre-existing custom helper text; it is never sent to the panel.
No token is requested or copied into that backup by the plugin. If managed values have
been edited externally, switching/removing refuses to overwrite them.

Explicit per-command credentials, other applications' own authentication, worktree
config overrides or more-specific URL rules can take precedence. Orca's native Push
has not been end-to-end verified; a config binding is not proof it uses these rules.
No push, commit, login or real credential lookup is performed automatically on Save.

## Author editing and safety

- Name/email saves affect future commits only; global/system settings and history stay
  unchanged. Worktree/command-level author overrides are read-only rather than pretending
  a repository-level edit wins. Worker identity environment overrides are flagged;
  separate terminals or agents can have their own environments.
- Both author edits and push binding changes use the standard Git `config.lock`, edit
  a temporary config and publish atomically. Failed edits leave the original intact.
  Revisions, workspace changes, external locks and malformed input are checked.
- SSH/paired/WSL workspaces, bare repositories and non-Git folders are unavailable.
  Symlinked repository config is refused rather than followed or replaced.
- External config changes need Refresh; a stale draft is rejected when saving.

## Access and verification

Runs a trusted Node worker with the user's OS access. Its sole host capability is
`workspace:read`, to find/revalidate the working tree. Git and gh subprocesses run
outside host capability enforcement. Repository config is written only when the user
switches the account, saves the author, or removes a binding. No terminal, agent, secret-storage or
plugin-storage capabilities are needed. The official `orca plugin open` CLI opens the
panel. Standard Windows HOME/APPDATA locations are restored when Orca omits them, so
Git and gh see the regular local user's configuration.

Account discovery/profile reads require network and use gh-managed credentials; only
public account metadata is requested. Git's installed helper retrieves a token later
when Git requests credentials. Config and backup JSON do not contain a retrieved gh
token. Do not enable Git credential tracing while using real credentials.

Tests use fake host responses, disposable repositories and an isolated global config.
They cover author saves, account/profile handling, binding/switch/removal/restoration,
URL routing, stale/externally edited config, rollback and a credential protocol test
with a fake gh function. No real tokens or remote push are used in tests.
