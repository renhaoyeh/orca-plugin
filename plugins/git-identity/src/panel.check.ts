import { defineCheck } from 'orca/testing'
import { identity, state } from './fixtures'
const accounts = () => [{ host: 'github.com', login: 'demo-author', available: true }, { host: 'github.com', login: 'work-account', available: true }]
export default defineCheck({
  bound: { requests: { 'github.accounts': accounts, 'identity.read': () => ({ ...state, pushBinding: { host: 'github.com', login: 'demo-author', managed: true } }) } },
  changedBinding: { requests: { 'github.accounts': accounts, 'identity.read': () => ({ ...state, pushBinding: { host: 'github.com', login: 'demo-author', managed: false } }) } },
  configured: { requests: { 'github.accounts': accounts, 'identity.read': () => state } },
  unset: { requests: { 'github.accounts': accounts, 'identity.read': () => ({ ...state, identity: { ...identity, name: '', email: '', nameSource: { scope: 'unset', origin: '' }, emailSource: { scope: 'unset', origin: '' } } }) } },
  unavailable: { requests: { 'github.accounts': () => [], 'identity.read': () => ({ workspaceId: null, workspaceName: '', identity: null, problem: 'Open a local Git workspace first.' }) } },
  override: { requests: { 'github.accounts': accounts, 'identity.read': () => ({ ...state, identity: { ...identity, canSave: false, environmentOverride: true } }) } },
  noGh: { requests: { 'github.accounts': () => { throw Error('No gh accounts available.') }, 'identity.read': () => state } },
})
