import test from 'node:test'
import assert from 'node:assert/strict'
import { listGitHubAccounts, readGitHubAuthor } from './github.mjs'
test('lists all gh accounts as safe metadata only and does not switch accounts or request tokens', async () => {
  let command
  const accounts = await listGitHubAccounts({ execute: async (bin, args) => {
    command = [bin, ...args]
    return { stdout: JSON.stringify([{ host: 'github.com', login: 'personal', state: 'success', token: 'never-return' }, { host: 'github.com', login: 'work', state: 'failure' }, { host: '--bad', login: 'bad', state: 'success' }]) }
  } })
  assert.deepEqual(accounts, [{ host: 'github.com', login: 'personal', available: true }, { host: 'github.com', login: 'work', available: false }])
  assert.deepEqual(command, ['gh', 'auth', 'status', '--json', 'hosts', '--jq', '[.hosts[][] | {host,login,state}]'])
})
test('loads the selected public profile even if it is not the active gh account; private email stays blank', async () => {
  const author = await readGitHubAuthor({ host: 'github.com', login: 'work' }, { execute: async (bin, args) => {
    assert.deepEqual(args, ['api', 'users/work', '--hostname', 'github.com', '--jq', '{login,name,email}'])
    return { stdout: JSON.stringify({ login: 'work', name: null, email: null }) }
  } })
  assert.deepEqual(author, { name: 'work', email: '' })
  await assert.rejects(readGitHubAuthor({ host: 'github.com', login: 'work' }, { execute: async () => ({ stdout: '{"login":"wrong"}' }) }), /does not match/)
})
test('invalid account input never executes a command; CLI failures do not leak output', async () => {
  let ran = false
  await assert.rejects(readGitHubAuthor({ host: 'github.com', login: '../bad' }, { execute: async () => { ran = true } }), /Invalid/)
  assert.equal(ran, false)
  await assert.rejects(listGitHubAccounts({ execute: async () => { throw Error('token=SECRET') } }), error => !error.message.includes('SECRET'))
})
