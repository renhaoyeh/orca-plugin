# MantisBT

Read-only native Orca sidebar, with the original herdr-zed MantisBT source data flow.
Requires Orca 1.4.259+; no HTML-panel/layout conversion.

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
  20-record server pages with Load more. Both retain exact project membership and use
  the server's `bug_resolved_status_threshold`, not a guessed hardcoded resolved status.
  An empty filtered page may still have a next page. Tab preference persists; page caches
  are separate and in-memory only, invalidated by refresh/reconnect/workspace changes.
- Group by Mantis status. Rows include ID, assignee, category, severity, colored priority,
  note count, updated/due dates and child count when available. Text filters the loaded
  issue ID/title/assignee/status/category; it is not a full server text search.
- Internal details include status, priority, severity, category, resolution, reproducibility,
  reporter, visibility, project, dates, tags, attachment count and custom fields. Original
  project field definitions type custom values and convert timestamp date fields.
- Description includes reproduction steps and additional information. Comments retain
  authors/dates and original chronological ordering. Parent/child relationships navigate
  inside the plugin; child reads exclude resolved/deleted issues. Back restores prior
  detail/list context. Only Open original launches the browser.

Colors use Orca theme semantic tones, not exact arbitrary Mantis RGB swatches. The source
status color/name/ID are retained for future richer rendering. Source resolution policy is
independent of display colors. Attachment bodies/images are not downloaded; only counts
are shown. Notes are bounded to 16,000 characters and the first 30 comments to 1,500
characters each, with a shortening notice. History is in memory and limited to 30 steps.

Not ported: Board/table layouts, in-list child expansion, configurable field visibility/order,
remembered selected issue, original on-disk issue caches, attachment downloads or Tasks import.
No remote writes, agents, dispatch or terminal operations.

## Source and access

`src/mantis-source.mjs` and `src/mantis-api.mjs` copy herdr-zed's `source-api.js` and
`api.js`, changing only relative imports. They own source projections, field definitions,
server-resolved threshold, filters, paging and relationships. `mantis-rest.mjs` adapts
those calls to the bounded GET-only transport in `api.mjs`; `mantis-client.mjs` projects
records for Orca. Do not replace these files with Asana's domain logic.

The trusted Node worker requires:

- `secrets:own`: encrypted `connection.v1`, retaining the original plugin/storage identity.
- `storage:own`: nonsecret project bindings and Mine/All preference.
- `workspace:read`: repository/folder/host context; no project file reads are performed.

Node fetch runs outside host capability enforcement, with the user's machine access.
It sends a token only to the explicitly configured Mantis server, tries raw then Bearer
auth on 401/403, refuses redirects and escaped API paths, has a 12-second per-request
timeout and a 4 MiB JSON-response limit, and does not echo response bodies or tokens in
errors. HTTP is permitted for legacy servers but visibly warns that tokens are unencrypted.
Review these grants before approval.

## Validation

```powershell
orca plugin test ./plugins/mantisbt --json
orca plugin check ./plugins/mantisbt --json
orca plugin dev reload ./plugins/mantisbt --json
```

Tests use mock HTTP, host context, encrypted storage and native panel interactions.
They cover flat `/users/me`, nested projects, non-default resolved thresholds, exact
membership, assigned-filter pagination, typed dates, details/comments/relationships,
server-scoped bindings, offline saving and safe errors. No real server connectivity or
account permissions are claimed: live verification is pending server availability.
