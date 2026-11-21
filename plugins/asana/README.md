# Asana

Read-only Asana task browser in Orca's sidebar. The panel follows Orca's
light or dark setting and uses a dedicated stylesheet for the project list,
task details, and loading placeholders.

## Open Asana

Select **Asana** in Orca's right sidebar. The panel restores the active workspace's
Asana project binding and shows the task list. Select a task to read its details
in the same panel. Use **Open in Asana** in the task toolbar to open its web page.

## Core behavior

- Personal access token edits save automatically after 650 ms without further edits;
  Enter saves immediately. Closing the panel flushes an idle pending draft. Like the
  original Asana source, saving a nonempty token does not itself perform an API login
  check; subsequent reads report authentication/access errors. Failed encrypted saves
  never fall back to plaintext or erase the prior token.
- Project search calls Asana workspace typeahead, as in the original implementation.
  It is not a filter of a previously loaded first page. Results show workspace names.
- Selecting a project saves a binding for the current Orca repository/folder and host.
  Reopening restores it; switching workspaces reloads the appropriate binding. Binding
  writes revalidate the scope after reading project information. A linked worktree uses
  the parent Orca project identity when available, matching the host project's scope.
- Mine is the default. It reads assigned open tasks across all pages of the Asana
  workspace, then filters project membership. All loads project open tasks a page at a
  time. Both use the original `completed_since=now` policy. Mine/All preference persists;
  the panel caches their loaded pages separately until refresh, reconnect or scope change.
- Tasks group by collapsible Asana Sections, retaining source order. Searching
  reveals matching tasks in every section. Dates are red when overdue and amber
  when due today. The active Mine/All
  control is accented. Search matches all typed words against loaded task names,
  assignees and sections. Rows include assignee, due date and subtask count.
- Clicking a task opens its notes, assignee, due date, Section, project, all returned
  custom fields and comments inside the plugin. Enum fields use semantic colors when
  Asana provides an option color. Parent links and open subtasks navigate internally;
  Back restores the prior detail or filtered list. Comment dates are displayed.
  Comments and subtasks use the original all-page/open-item policies. Completed/deleted
  task previews are rejected. Detail history is in memory only.
- **Start work** below the task title opens a dialog with the Agents available for the
  focused workspace. Choose the task details or share its title and link, then select
  **Start session**.
  The handoff targets the workspace ID revalidated at launch and opens a new Agent using
  the user's Chat/CLI preference. It requires the `agent:launch` grant; it does not create
  a worktree or change Asana.
- Only an explicit **Open in Asana** press launches the browser. The panel uses
  read-only API requests and keeps a short-lived in-memory cache in the worker.
  Disconnect clears this plugin's local token.

## Reused source vs Orca adapters

`src/asana-source.mjs` and `src/asana-api.mjs` are copied from herdr-zed's Asana
`source-api.js` and `api.js`, with only relative imports changed. They own API projection,
project typeahead, open-task policy, Mine membership, pagination and comment filtering.
`asana-rest.mjs` adapts them to the bounded Orca Node transport in `api.mjs`.
`asana-client.mjs` maps their original domain records to the native panel model.

The first-version MantisBT plugin remains separate. Their panel/domain logic is no
longer a shared implementation; do not overwrite Asana with the Mantis source copies.

Not yet ported: configurable custom-field display/order, remembered selected task,
all-project aggregation and Tasks import.
Custom-field and due-date colors use accessible palettes for each theme.

## Access and security

Requires Orca 1.4.259+ and its trusted Node worker. Host capabilities:

- `secrets:own`: this plugin's encrypted token (`connection.v1`), never returned to the panel.
- `storage:own`: nonsecret repository/project bindings and Mine/All preference.
- `workspace:read`: identify the active repository/folder/host, not read project files.
- `agent:launch`: list installed Agents and launch a new Agent in the current workspace
  only after the person reviews the prompt and clicks Launch.

The worker uses read-only Node fetch outside host capability enforcement, only to
`https://app.asana.com/api/1.0`. Every request rejects redirects, uses normal TLS,
has a 12-second timeout and a 4 MiB JSON-response limit. API errors do not echo bodies,
headers or tokens. No terminal/agent permissions and no herdr-zed credential migration.

Preview text is bounded to 16,000 notes characters and 30 comments of 1,500 characters;
shortening is marked. Images and attachments are not downloaded.

## Development

```powershell
orca plugin dev load ./plugins/asana --json
orca plugin test ./plugins/asana --json
orca plugin check ./plugins/asana --json
orca plugin open local.asana --panel issues --json
```

Inspect/review the approval before enabling. Tests use mock HTTP/storage/host context,
not a real token. Live project discovery has also been verified on the local Orca host;
read-only task/detail API reads have also succeeded, including returned custom fields.
Real parent/subtask UI navigation still has only mocked coverage and depends on permissions.
Panel state tests cover token settings, project search, task navigation, view
caching and switching between worktrees with the same binding.
