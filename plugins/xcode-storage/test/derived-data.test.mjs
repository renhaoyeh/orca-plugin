import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseWorkspace, remove, scan } from '../src/derived-data.mjs'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'xcode-storage-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'Library', 'Developer', 'Xcode', 'DerivedData')
  await mkdir(root, { recursive: true })
  return { home, root }
}

const plist = path => '<plist><dict><key>WorkspacePath</key><string>' + path + '</string></dict></plist>'

test('parses absolute workspace metadata and XML entities', () => {
  assert.equal(parseWorkspace(plist('/a&amp;b&#x20;c&#47;d')), '/a&b c/d')
  assert.equal(parseWorkspace(plist('../workspace')), null)
  assert.equal(parseWorkspace('unrecognized'), null)
})

test('reports size, identifies missing workspaces, and skips symlink entries', async t => {
  const { home, root } = await fixture(t)
  const missing = join(root, 'Project-' + 'a'.repeat(28))
  const existing = join(root, 'Working')
  const workspace = join(home, 'Working.xcworkspace')
  await mkdir(missing)
  await mkdir(existing)
  await mkdir(workspace)
  await writeFile(join(missing, 'info.plist'), plist(join(home, 'gone.xcworkspace')))
  await writeFile(join(existing, 'info.plist'), plist(workspace))
  await symlink(missing, join(root, 'link'))
  await writeFile(join(root, 'file'), 'data')
  const rows = await scan(home)
  assert.equal(rows.length, 2)
  const project = rows.find(row => row.name === 'Project')
  assert.equal(project.missing, true)
  assert.ok(project.size > 0)
  assert.equal(rows.find(row => row.name === 'Working').missing, false)
})

test('reads binary Xcode metadata on macOS', { skip: process.platform !== 'darwin' }, async t => {
  const { home, root } = await fixture(t)
  const folder = join(root, 'Binary')
  const workspace = join(home, 'Binary.xcworkspace')
  await mkdir(folder)
  const binary = execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', '-', '-'], { input: plist(workspace) })
  await writeFile(join(folder, 'info.plist'), binary)
  const [row] = await scan(home)
  assert.equal(row.workspace, workspace)
  assert.equal(row.missing, true)
})

test('removes only the selection and preserves targets of symlinks within it', async t => {
  const { home, root } = await fixture(t)
  const external = join(home, 'outside')
  const keep = join(root, 'Keep')
  const selected = join(root, 'Selected')
  await mkdir(external)
  await writeFile(join(external, 'marker'), 'safe')
  await mkdir(keep)
  await mkdir(selected)
  await symlink(external, join(selected, 'nested-link'))
  const choices = await scan(home)
  const row = choices.find(folder => folder.id === 'Selected')
  assert.deepEqual(remove(home, [row, row]), { removed: ['Selected'], errors: [] })
  await assert.rejects(lstat(selected), { code: 'ENOENT' })
  assert.ok((await lstat(keep)).isDirectory())
  assert.equal(await readFile(join(external, 'marker'), 'utf8'), 'safe')
})

test('rejects traversal, root and child symlinks, and changed folder identity', async t => {
  const { home, root } = await fixture(t)
  const selected = join(root, 'Selected')
  const outside = join(home, 'outside')
  await mkdir(selected)
  await mkdir(outside)
  const [row] = await scan(home)
  await rename(selected, join(outside, 'Selected'))
  await symlink(join(outside, 'Selected'), selected)
  assert.equal(remove(home, [row]).removed.length, 0)
  const invalid = ['..', '../outside', '/outside', 'a\\b', '.hidden', 'a\0b', '', null]
  assert.equal(remove(home, invalid.map(id => ({ id, identity: row.identity }))).errors.length, invalid.length)
  await rm(selected)
  await mkdir(selected)
  assert.match(remove(home, [row]).errors[0], /changed since the scan/)
  await rename(root, join(home, 'old-root'))
  await symlink(outside, root)
  assert.equal(remove(home, [row]).removed.length, 0)
  await assert.rejects(scan(home), /without symlinks/)
  assert.ok((await lstat(join(outside, 'Selected'))).isDirectory())
})
