# Agent Usage

Open **Agent Usage** in Orca's right sidebar. Accounts with reported usage
appear in compact cards grouped by provider.

The meters default to used percentage. The header button switches between
Used and Left percentages and remembers the selection. Health tone reflects
used percentage in either mode. The refresh button reads Orca's
latest snapshot.

Requires Orca 1.4.274 or later. The trusted worker runs
`orca account list --json` on the host that runs the plugin. It reads
Orca's current and inactive account meters and returns display data to the
panel. Orca manages provider refreshes.

Provider icons come from [Lobe Icons](https://github.com/lobehub/lobe-icons)
(`@lobehub/icons-static-png` 2.10.0, MIT).

```powershell
orca plugin check ./plugins/agent-usage --json
orca plugin test ./plugins/agent-usage --json
orca plugin dev load ./plugins/agent-usage --json
```
