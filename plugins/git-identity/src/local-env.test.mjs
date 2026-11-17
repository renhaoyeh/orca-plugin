import test from 'node:test'
import assert from 'node:assert/strict'
import { localEnvironment } from './local-env.mjs'
test('restores omitted worker profile paths so gh and Git see the same local account as the shell', () => {
  const source = { USERPROFILE: 'C:\\Users\\Demo', PATH: 'keep' }
  const env = localEnvironment(source, 'win32')
  assert.equal(env.HOME, source.USERPROFILE)
  assert.equal(env.APPDATA, 'C:\\Users\\Demo\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\Demo\\AppData\\Local')
  assert.equal(source.APPDATA, undefined)
  assert.equal(env.PATH, 'keep')
  assert.equal(localEnvironment({ ...source, APPDATA: 'custom', GH_CONFIG_DIR: 'chosen' }, 'win32').APPDATA, 'custom')
  assert.equal(localEnvironment({ ...source, GH_CONFIG_DIR: 'chosen' }, 'win32').GH_CONFIG_DIR, 'chosen')
})
