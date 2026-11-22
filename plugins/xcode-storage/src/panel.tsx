import {
  atom, read, set, update, plugin, type PanelContext, Stack, Row, Heading, Text,
  Badge, Button, Checkbox, Callout, EmptyState, Spinner, IconButton, Separator, Box,
} from 'orca'
import type { CacheFolder, ScanResult } from './protocol'

const data = atom<ScanResult | null>(null)
const selected = atom<string[]>([])
const reviewing = atom(false)
const busy = atom(false)
const errors = atom<string[]>([])
const removedCount = atom(0)
let panelSignal: AbortSignal | undefined
let firstSuccessfulScan = true

async function refresh() {
  const signal = panelSignal
  set(reviewing, false)
  const result = await plugin.request('storage.scan', undefined, { signal, timeoutMs: 120000 })
  if (signal?.aborted) return
  set(data, result)
  if (firstSuccessfulScan && result.supported) {
    set(selected, result.folders.filter(folder => folder.missing).map(folder => folder.id))
    firstSuccessfulScan = false
  } else {
    const available = new Set(result.folders.map(folder => folder.id))
    update(selected, ids => ids.filter(id => available.has(id)))
  }
}

async function run(action: () => Promise<void>) {
  const signal = panelSignal
  if (read(busy) || signal?.aborted) return
  set(busy, true)
  set(errors, [])
  set(removedCount, 0)
  try {
    await action()
  } catch (error) {
    if (!signal?.aborted) {
      update(errors, messages => [...messages, error instanceof Error ? error.message : String(error)])
    }
  } finally {
    if (!signal?.aborted) set(busy, false)
  }
}

export function setup(ctx: PanelContext) {
  panelSignal = ctx.signal
  firstSuccessfulScan = true
  void run(refresh)
}

function deleteSelected() {
  if (!read(reviewing)) return
  const ids = new Set(read(selected))
  const folders = read(data)?.folders.filter(folder => ids.has(folder.id)) ?? []
  if (!folders.length) return
  return run(async () => {
    const signal = panelSignal
    set(reviewing, false)
    set(selected, [])
    try {
      const result = await plugin.request('storage.remove', {
        confirmed: true,
        folders: folders.map(({ id, identity }) => ({ id, identity })),
      }, { signal, timeoutMs: 120000 })
      if (signal?.aborted) return
      set(errors, result.errors)
      set(removedCount, result.removed.length)
    } finally {
      if (!signal?.aborted) await refresh()
    }
  })
}

function formatSize(bytes: number | null) {
  if (bytes === null) return 'Size unavailable'
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unit = 0
  while (bytes >= 1024 && unit < sizes.length - 1) {
    bytes /= 1024
    unit += 1
  }
  return bytes.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + sizes[unit]
}

function totalSize(folders: CacheFolder[]) {
  return folders.reduce((total, folder) => total + (folder.size ?? 0), 0)
}

function groupFolders(folders: CacheFolder[]) {
  const groups = new Map<string | null, CacheFolder[]>()
  for (const folder of folders) {
    const project = folder.workspace ? folder.name : null
    const group = groups.get(project)
    if (group) group.push(folder)
    else groups.set(project, [folder])
  }
  return Array.from(groups, ([project, items]) => ({
    project,
    size: totalSize(items),
    items: items.sort((a, b) => Number(b.missing) - Number(a.missing) || (b.size ?? -1) - (a.size ?? -1)),
  })).sort((a, b) => b.size - a.size)
}

function selectFolders(folderIds: string[], checked: boolean) {
  if (read(busy) || read(reviewing)) return
  const affected = new Set(folderIds)
  update(selected, ids => checked ? [...new Set([...ids, ...affected])] : ids.filter(id => !affected.has(id)))
}

function workspaceLabel(workspace: string) {
  const buildId = workspace.match(/(?:^|\/)eas-build-local-nodejs\/([\da-f]{8})[\da-f-]*(?:\/|$)/i)?.[1]
  if (buildId) return `EAS local build · ${buildId}`
  return workspace.split('/').filter(Boolean).slice(-2).join('/') || workspace
}

function Capacity({ bytes, subtotal = false }: { bytes: number | null; subtotal?: boolean }) {
  return <Box width={92} shrink={false} align="end">
    <Text size="xs" muted={!subtotal} weight={subtotal ? 'semibold' : undefined}>{formatSize(bytes)}</Text>
  </Box>
}

function FolderRow({ folder, checked }: { folder: CacheFolder; checked: boolean }) {
  return <Box direction="row" align="center" gap="sm" paddingX="sm" paddingY="xs">
    <Box direction="row" align="center" gap="sm" wrap grow minWidth={0}>
      <Box maxWidth="100%" minWidth={0}>
        <Checkbox label={folder.workspace ? workspaceLabel(folder.workspace) : folder.id}
          checked={checked} onChange={value => selectFolders([folder.id], value)} />
      </Box>
      {folder.missing && <Badge tone="warning">Workspace missing</Badge>}
    </Box>
    <Capacity bytes={folder.size} />
  </Box>
}

export default function Panel() {
  const scan = read(data)
  const pending = read(busy)
  const review = read(reviewing)
  const ids = new Set(read(selected))
  const messages = read(errors)
  const removed = read(removedCount)
  const folders = scan?.folders ?? []
  const checkedFolders = folders.filter(folder => ids.has(folder.id))
  const missingIds = folders.filter(folder => folder.missing).map(folder => folder.id)
  const count = checkedFolders.length
  return <Stack gap="md">
    <Row align="center" justify="between" gap="sm">
      <Heading level={2}>Xcode Storage</Heading>
      <IconButton icon="refresh" label="Refresh" disabled={pending || review || scan?.supported === false}
        onPress={() => run(refresh)} />
    </Row>
    {messages.length > 0 && <Callout tone="danger" title="Xcode Storage">
      <Stack gap="xs">{messages.map((message, index) => <Text key={index}>{message}</Text>)}</Stack>
    </Callout>}
    {removed > 0 && <Text tone="success">{`Deleted ${removed} ${removed === 1 ? 'folder' : 'folders'}.`}</Text>}
    {pending && <Spinner label="Updating DerivedData…" />}
    {!pending && scan?.supported === false &&
      <EmptyState title="macOS required" description="Xcode Storage reads DerivedData on macOS." />}
    {!pending && scan?.supported && !folders.length &&
      <EmptyState title="No DerivedData folders" icon="folder" />}
    {!pending && folders.length > 0 && <>
      <Heading level={3}>DerivedData</Heading>
      {review ? <Callout tone="warning" title={`Delete ${count} DerivedData ${count === 1 ? 'folder' : 'folders'}?`}>
        <Stack gap="sm">
          <Text>{`Total known size is ${formatSize(totalSize(checkedFolders))}. Deletion is permanent. Xcode will rebuild these caches as needed.`}</Text>
          {checkedFolders.map(folder => <Text key={folder.id} size="sm">{folder.id}</Text>)}
          <Row gap="sm" wrap>
            <Button variant="outline" onPress={() => set(reviewing, false)}>Cancel</Button>
            <Button tone="danger" onPress={deleteSelected}>Delete</Button>
          </Row>
        </Stack>
      </Callout> : <>
        <Row gap="sm" wrap>
          {missingIds.length > 0 && <Button variant="outline" onPress={() => selectFolders(missingIds, true)}>
            {`Select ${missingIds.length} with missing workspace`}
          </Button>}
          <Button variant="outline" disabled={!count} onPress={() => set(reviewing, true)}>
            {count ? `Review deletion (${count})` : 'Review deletion'}
          </Button>
        </Row>
        <Stack gap="lg">{groupFolders(folders).map(({ project, size, items }) =>
          <Stack key={project === null ? 'shared' : `project:${project}`} gap="xs">
            <Box width="100%" background="muted" radius="sm" padding="sm" direction="row" align="center" gap="sm">
              <Box grow minWidth={0}>
                <Checkbox label={`${project ?? 'Shared caches'} · ${items.length} ${items.length === 1 ? 'folder' : 'folders'}`}
                  checked={items.every(folder => ids.has(folder.id))}
                  onChange={value => selectFolders(items.map(folder => folder.id), value)} />
              </Box>
              <Capacity bytes={size} subtotal />
            </Box>
            <Stack gap="none">{items.map((folder, rowIndex) =>
              <Stack key={folder.id} gap="none">
                {rowIndex > 0 && <Separator />}
                <FolderRow folder={folder} checked={ids.has(folder.id)} />
              </Stack>
            )}</Stack>
          </Stack>
        )}</Stack>
      </>}
    </>}
  </Stack>
}
