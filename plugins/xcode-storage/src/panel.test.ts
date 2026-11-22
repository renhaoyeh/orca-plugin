import { assert, mockHost, mount, test } from 'orca/testing'
import type { CacheFolder, FolderSelection } from './protocol'
import * as panel from './panel'

test('reviews selected folders, cancels, then deletes only the confirmed selection and refreshes', async () => {
  let scanCount = 0
  const requests: FolderSelection[][] = []
  const first: CacheFolder = {
    id: 'Example-hash', name: 'Example', identity: 'first',
    workspace: '/private/var/folders/tmp/eas-build-local-nodejs/b548bc22-2d9e-4c89-b3c3-a73e8a3c1382/build/app/ios/Example.xcworkspace',
    missing: true, size: 1024,
  }
  const second: CacheFolder = {
    id: 'SharedCache', name: 'SharedCache', identity: 'second', workspace: null, missing: false, size: null,
  }
  const view = await mount(panel, {
    host: mockHost({ requests: {
      'storage.scan': () => ({ supported: true, folders: ++scanCount === 1 ? [first, second] : [second] }),
      'storage.remove': input => {
        const payload = input as { confirmed: boolean; folders: FolderSelection[] }
        assert.equal(payload.confirmed, true)
        requests.push(payload.folders)
        return { removed: [first.id], errors: [] }
      },
    } }),
  })
  try {
    assert.ok(view.find({ text: 'Workspace missing' }))
    const choice = view.find({ label: 'EAS local build · b548bc22' })
    assert.ok(choice?.props.checked)
    assert.equal(choice?.props.description, undefined)
    await view.press({ text: 'Review deletion (1)' })
    assert.ok(view.find({ text: first.id }))
    assert.ok(view.find({ text: 'Total known size is 1 KiB. Deletion is permanent. Xcode will rebuild these caches as needed.' }))
    assert.equal(view.find({ text: 'Delete' })?.props.tone, 'danger')
    await view.press({ text: 'Cancel' })
    assert.equal(requests.length, 0)
    await view.press({ text: 'Review deletion (1)' })
    await view.press({ text: 'Delete' })
    assert.deepEqual(requests, [[{ id: first.id, identity: first.identity }]])
    assert.equal(scanCount, 2)
    assert.ok(view.find({ label: 'SharedCache' }))
    assert.ok(view.find({ text: 'Deleted 1 folder.' }))
    assert.equal(view.find({ label: 'EAS local build · b548bc22' }), null)
  } finally {
    await view.unmount()
  }
})

test('groups by total size and lets users select a group or all missing workspaces', async () => {
  const folders: CacheFolder[] = [
    { id: 'active', name: 'Example', workspace: '/Projects/current/ios/Example.xcworkspace', missing: false, size: 4096, identity: '1' },
    { id: 'other', name: 'Other', workspace: '/other', missing: false, size: 5120, identity: '2' },
    { id: 'small', name: 'Example', workspace: '/small', missing: true, size: 1024, identity: '3' },
    { id: 'BuildCache', name: 'BuildCache', workspace: null, missing: false, size: 6144, identity: '4' },
    { id: 'large', name: 'Example', workspace: '/large', missing: true, size: 2048, identity: '5' },
    { id: 'ModuleCache', name: 'ModuleCache', workspace: null, missing: false, size: null, identity: '6' },
  ]
  const view = await mount(panel, {
    host: mockHost({ requests: { 'storage.scan': () => ({ supported: true, folders }) } }),
  })
  try {
    assert.deepEqual(view.findAll({ type: 'Checkbox' }).map(node => node.props.label), [
      'Example · 3 folders', 'large', 'small', 'ios/Example.xcworkspace',
      'Shared caches · 2 folders', 'BuildCache', 'ModuleCache', 'Other · 1 folder', 'other',
    ])
    assert.equal(view.findAll({ type: 'Separator' }).length, 3)
    assert.ok(view.find({ text: 'Review deletion (2)' }))
    await view.toggle({ label: 'Example · 3 folders' })
    assert.ok(view.find({ text: 'Review deletion (3)' }))
    await view.toggle({ label: 'Example · 3 folders' })
    await view.toggle({ label: 'Shared caches · 2 folders' })
    await view.press({ text: 'Select 2 with missing workspace' })
    assert.ok(view.find({ text: 'Review deletion (4)' }))
    await view.press({ text: 'Review deletion (4)' })
    assert.ok(view.find({ text: 'Total known size is 9 KiB. Deletion is permanent. Xcode will rebuild these caches as needed.' }))
  } finally {
    await view.unmount()
  }
})

test('preselects after a failed initial scan, preserves surviving selection on refresh, and clears it after deletion', async () => {
  const folder = (id: string, missing: boolean): CacheFolder =>
    ({ id, name: id, workspace: '/' + id, missing, size: null, identity: id })
  const gone = folder('gone', true)
  const stale = folder('stale', true)
  const active = folder('active', false)
  const added = folder('added', true)
  let scanCount = 0
  const requests: FolderSelection[][] = []
  const view = await mount(panel, {
    host: mockHost({ requests: {
      'storage.scan': () => {
        if (++scanCount === 1) throw new Error('Scan failed')
        return { supported: true, folders: scanCount === 2 ? [gone, stale, active] : [stale, active, added] }
      },
      'storage.remove': input => {
        requests.push((input as { folders: FolderSelection[] }).folders)
        return { removed: [], errors: ['Folder could not be deleted'] }
      },
    } }),
  })
  try {
    assert.ok(view.find({ text: 'Scan failed' }))
    await view.press({ label: 'Refresh' })
    assert.ok(view.find({ label: 'gone' })?.props.checked)
    assert.ok(view.find({ label: 'stale' })?.props.checked)
    await view.toggle({ label: 'stale' })
    await view.toggle({ label: 'active' })
    await view.press({ label: 'Refresh' })
    assert.equal(view.find({ label: 'gone' }), null)
    assert.equal(view.find({ label: 'stale' })?.props.checked, false)
    assert.equal(view.find({ label: 'added' })?.props.checked, false)
    assert.ok(view.find({ label: 'active' })?.props.checked)
    await view.press({ text: 'Review deletion (1)' })
    await view.press({ text: 'Delete' })
    assert.deepEqual(requests, [[{ id: active.id, identity: active.identity }]])
    assert.equal(scanCount, 4)
    assert.equal(view.find({ label: 'active' })?.props.checked, false)
    assert.ok(view.find({ text: 'Folder could not be deleted' }))
  } finally {
    await view.unmount()
  }
})
