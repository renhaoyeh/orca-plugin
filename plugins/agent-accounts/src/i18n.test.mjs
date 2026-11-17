import test from 'node:test'
import assert from 'node:assert/strict'
import { localeOf, text } from './i18n.mjs'

test('defaults to English and resolves Chinese regions and scripts', () => {
  assert.equal(text('Agent 帳號'), 'Agent Accounts')
  assert.equal(text('Agent Accounts', 'zh-TW'), 'Agent 帳號')
  assert.equal(text('Agent 帳號', 'zh-CN'), 'Agent 账号')
  assert.equal(text('開啟 Codex 終端'), 'Open Codex terminal')
  assert.equal(localeOf('en-GB'), 'en')
  assert.equal(localeOf('fr-FR'), 'en')
  assert.equal(localeOf('zh_Hant_TW'), 'zh-TW')
  assert.equal(localeOf('zh-HK'), 'zh-TW')
  assert.equal(localeOf('zh-Hans-CN'), 'zh-CN')
  assert.equal(text('Open Codex terminal', 'zh-TW'), '開啟 Codex 終端')
  assert.equal(text('開啟 Codex 終端', 'zh-CN'), '打开 Codex 终端')
})

test('preserves account names and native errors while translating tooltip templates', () => {
  assert.equal(text('Personal (Pro 100)', 'zh-TW'), 'Personal (Pro 100)')
  assert.equal(text('runtime_unavailable: connection lost', 'zh-CN'), 'runtime_unavailable: connection lost')
  assert.equal(text('用 {name} 開啟 Codex 終端', 'en', { name: '公司' }), 'Open a Codex terminal as 公司')
})
