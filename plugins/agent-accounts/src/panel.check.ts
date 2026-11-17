import { defineCheck, hostError } from 'orca/testing'

const state = {
  accounts: [
    { id: 'personal', label: 'Personal · demo@example.test', disabledReason: '' },
    { id: 'work', label: 'Work · team@example.test', disabledReason: '' },
    { id: 'wsl', label: 'Linux account', disabledReason: '尚未支援 WSL 帳號。' },
  ], workspaceId: 'demo', workspaceName: 'Demo project', workspaceError: '',
}

export default defineCheck({
  piEntry: { requests: { 'accounts.locale': () => ({ ...state, accounts: [...state.accounts, { id: 'pi-default', label: 'Pi', identityLabel: 'Pi', disabledReason: '', provider: 'pi' }] }) } },
  apiProfile: { requests: { 'accounts.locale': () => ({ ...state, accounts: [{ id: 'api-demo', label: 'Paid API · API', identityLabel: 'Paid API · API', disabledReason: '', kind: 'api' }] }) } },
  accounts: { requests: { 'accounts.locale': () => state } },
  empty: { requests: { 'accounts.locale': () => ({ ...state, accounts: [] }) } },
  noWorkspace: { requests: { 'accounts.locale': () => ({ ...state, workspaceId: null, workspaceError: '請先開啟一個工作區。' }) } },
  error: { requests: { 'accounts.locale': () => { throw hostError('action_failed', 'Orca CLI unavailable') } } },
})
