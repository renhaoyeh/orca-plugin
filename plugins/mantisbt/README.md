# MantisBT

Read-only MantisBT browser in Orca's right sidebar. Its light palette, blue
widget headers, issue table, and activities use herdr-zed's MantisBT styling
adapted for the sidebar width. Requires Orca 1.4.259+.

## Flow

- Server URL and API token edits autosave after 650 ms; Enter saves immediately.
  Valid local settings are encrypted even while the server is offline. As in the original
  source hooks, saving is not a successful login test. Subsequent reads show network or
  permission errors. Invalid input or an encrypted-store failure preserves the prior secret.
  The form stays open after autosave; close it with the settings control to browse.
- Never reuse an old token when changing servers. Enter a token for the new server.
  Tokens are never returned to the panel, imported from herdr-zed or stored in plaintext.
- Search uses the original five-minute project cache, recursive subproject flattening,
  deduplication and multiword matching against project and parent names. It never chooses
  the first project automatically.
- Explicit project selection persists per Orca project/folder + host + Mantis server URL.
  Workspace changes restore the correct binding. Changing the server does not accidentally
  reuse a project ID from another server. Binding writes revalidate scope after the read.
- Mine sends Mantis `filter_id=assigned` and follows every page. All loads original
  20-record server pages with Load more or Fetch all issues. Stop fetching keeps the
  completed pages. Both retain exact project membership and use
  the server's `bug_resolved_status_threshold`, not a guessed hardcoded resolved status.
  An empty filtered page may still have a next page. Tab preference persists.
  The panel keeps separate Mine/All pages. The worker shares recent issue, detail,
  and relationship reads across sidebar opens and clears them on refresh or reconnect.
- Collapsible groups follow Mantis status. Text search and multi-select filters apply
  to the loaded issues. Select multiple values within Reporter, Assignee, Status,
  Category, Priority or Severity and combine filters across those fields.
- Field display saves visibility and order separately for list fields and issue
  details for each Mantis server and project. Both views support project custom fields.
- Internal details include status, priority, severity, category, resolution, reproducibility,
  reporter, visibility, project, dates, tags, attachment count and custom fields. Original
  project field definitions type custom values and convert timestamp date fields.
- Description includes reproduction steps and additional information. Comments retain
  authors/dates and original chronological ordering. Parent/child relationships navigate
  inside the plugin; child reads exclude resolved/deleted issues. Back restores prior
  detail/list context. Reopening the sidebar restores the issue that was open for
  that workspace, server and project. Returning to the list clears that selection.
  From issue details, the issue number and Open original open the original issue in the browser.

Status swatches use the configured server color when it supplies a hexadecimal color,
with standard Mantis colors as fallbacks. Attachment bodies/images are not downloaded; only counts
are shown. Notes are bounded to 16,000 characters and the first 30 comments to 1,500
characters each, with a shortening notice. History is in memory and limited to 30 steps.

Not ported: wide table, in-list child expansion,
original on-disk issue caches, attachment downloads or Tasks import.
No remote writes, agents, dispatch or terminal operations.

## Source and access

`src/mantis-source.mjs` and `src/mantis-api.mjs` copy herdr-zed's `source-api.js` and
`api.js`, changing only relative imports. They own source projections, field definitions,
server-resolved threshold, filters, paging and relationships. `mantis-rest.mjs` adapts
those calls to the bounded GET-only transport in `api.mjs`; `mantis-client.mjs` projects
records for Orca. Do not replace these files with Asana's domain logic.

The trusted Node worker requires:

- `secrets:own`: encrypted `connection.v1`, retaining the original plugin/storage identity.
- `storage:own`: nonsecret project bindings, Mine/All preference, field layouts and the open issue ID.
- `workspace:read`: repository/folder/host context; no project file reads are performed.

Node fetch runs outside host capability enforcement, with the user's machine access.
It sends a token only to the explicitly configured Mantis server, tries raw then Bearer
auth on 401/403, refuses redirects and escaped API paths, has a 12-second per-request
timeout, and does not echo response bodies or tokens in errors. The project list returns all
accessible projects with metadata in one response and has a 32 MiB limit. Other API responses
have a 4 MiB limit. HTTP is permitted for legacy servers but visibly warns that tokens are
unencrypted.
Review these grants before approval.

## Validation

```powershell
orca plugin test ./plugins/mantisbt --json
orca plugin check ./plugins/mantisbt --json
orca plugin dev reload ./plugins/mantisbt --json
```

Tests use mock HTTP, host context, encrypted storage and sidebar state transitions.
They cover flat `/users/me`, nested projects, non-default resolved thresholds, exact
membership, assigned-filter pagination, typed dates, details/comments/relationships,
server-scoped bindings, offline saving, response limits and safe errors.
