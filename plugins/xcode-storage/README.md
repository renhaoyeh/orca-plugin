# Xcode Storage

Review the local Xcode DerivedData folders and their disk usage in an Orca sidebar
on macOS. When a folder's Xcode metadata points to a workspace that no longer exists,
the panel marks it **Workspace missing** and selects it on the first successful scan.
Folders are grouped by project, with folders that have no workspace under **Shared
caches**. Refresh keeps selections for folders still in the list.

Select the folders you want to remove, choose **Review deletion**, then confirm
**Delete** after checking the folder count and total known size. This permanently
removes the selected caches and refreshes the list. Xcode rebuilds caches as needed.
Cleanup is limited to direct folders under
`~/Library/Developer/Xcode/DerivedData`.

The trusted worker reads local metadata, measures allocated space with `du`, and
deletes the confirmed folders with Node's filesystem API.

## Development

From the repository root, run:

```sh
orca plugin validate ./plugins/xcode-storage --json
orca plugin test ./plugins/xcode-storage --json
orca plugin check ./plugins/xcode-storage --json
node --test plugins/xcode-storage/test/derived-data.test.mjs
```

Panel checks use mock responses. Filesystem tests create temporary fixtures.
