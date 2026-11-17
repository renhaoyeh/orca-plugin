import { atom, read, set, plugin, on, env, Stack, Row, Box, Heading, Text, Button, IconButton, Input, Callout, Badge, EmptyState, Spinner, type PanelContext } from 'orca'
import type { AccountState } from './protocol'
import { text } from './i18n.mjs'

const state = atom<AccountState | null>(null)
const busy = atom(false)
const error = atom('')
const notice = atom('')
const drafts = atom<Record<string, string>>({})
const editing = atom<string | null>(null)
let revision = 0
const t = (source: string) => text(source, env.locale)

async function refresh() {
  const request = ++revision
  set(error, '')
  set(notice, '')
  try {
    const answer = await plugin.request('accounts.locale', { locale: env.locale })
    if (request === revision) set(state, answer)
  } catch (cause) {
    if (request === revision) set(error, cause instanceof Error ? cause.message : String(cause))
  }
}

async function addAccount(provider: 'codex' | 'claude') {
  const current = read(state)
  if (read(busy) || !current?.workspaceId) return
  set(busy, true)
  set(error, '')
  set(notice, '')
  try {
    const result = await plugin.request('accounts.add', { provider, workspaceId: current.workspaceId })
    set(notice, 'pending' in result ? '正在開啟，請稍候。' : '登入終端已開啟，完成登入後請重新整理帳號清單。')
  } catch (cause) { set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}

async function addPi() {
  if (read(busy)) return
  set(busy, true)
  set(error, '')
  set(notice, '')
  try {
    set(state, await plugin.request('accounts.pi.add'))
    set(notice, 'Pi 已加入，點選底部狀態列即可開啟。')
  } catch (cause) { set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}

async function removePi() {
  if (read(busy)) return
  set(busy, true)
  set(error, '')
  set(notice, '')
  try {
    set(state, await plugin.request('accounts.pi.remove'))
    set(editing, null)
    set(notice, 'Pi 入口已移除，現有分頁與登入不受影響。')
  } catch (cause) { set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}

async function rename(accountId: string) {
  if (read(busy)) return
  set(busy, true)
  set(error, '')
  try {
    const answer = await plugin.request('accounts.rename', { accountId, name: read(drafts)[accountId] ?? '' })
    set(state, answer)
    const next = { ...read(drafts) }
    delete next[accountId]
    set(drafts, next)
    set(editing, null)
    set(notice, '顯示名稱已儲存。')
  } catch (cause) { set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}

export function setup(ctx: PanelContext) {
  let previousKey: string | undefined
  ctx.subscriptions.push(on('workspace.changed', ({ context }) => {
    // Terminal title/status changes also emit this event; they do not change our account list.
    const key = JSON.stringify([context?.workspaceId ?? null, context?.displayName ?? ''])
    if (key === previousKey) return
    previousKey = key
    const current = read(state)
    if (current && current.workspaceId === (context?.workspaceId ?? null) && current.workspaceName === (context?.displayName ?? '')) return
    set(state, null)
    void refresh()
  }))
  void refresh()
  return () => { revision++ }
}

async function removeApiProfile(accountId: string) {
  if (read(busy)) return
  set(busy, true)
  set(error, '')
  try {
    set(state, await plugin.request('accounts.api.remove', { accountId }))
    set(notice, 'API profile removed. Existing terminals are unchanged.')
  } catch (cause) { set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}

export default function Panel() {
  const value = read(state)
  const pending = read(busy)
  return <Stack gap="lg">
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Heading level={2}>{t('Agent 帳號')}</Heading>
        <IconButton variant="ghost" icon="refresh" label={t('重新整理')} disabled={pending} onPress={refresh} />
      </Row>
      <Text muted size="sm">{t('點選底部狀態列項目即可啟動 Agent。')}</Text>
    </Stack>
    {read(error) && <Callout tone="danger" title={t('無法完成')}>{t(read(error))}</Callout>}
    {read(notice) && <Callout tone="success">{t(read(notice))}</Callout>}
    {!value && !read(error) && <Spinner label={t('讀取帳號')} />}
    {value && <Stack gap="md">
      <Row justify="between" align="center">
        <Text muted size="sm" weight="medium">{t('帳號清單')}</Text>
        <Badge>{value.accounts.length}</Badge>
      </Row>
      <Row gap="sm" wrap>
        <Button variant="outline" size="sm" icon="add" disabled={pending || !value.workspaceId} onPress={() => addAccount('codex')}>{t('新增 Codex 帳號')}</Button>
        <Button variant="outline" size="sm" icon="add" disabled={pending || !value.workspaceId} onPress={() => addAccount('claude')}>{t('新增 Claude 帳號')}</Button>
        <Button variant="outline" size="sm" icon="add" disabled={pending || value.accounts.some(account => account.provider === 'pi')} onPress={addPi}>{t('新增 Pi')}</Button>
      </Row>
      {value.workspaceError && <Text muted size="sm">{t(value.workspaceError)}</Text>}
      {value.accounts.length === 0 && <EmptyState icon="terminal" title={t('尚無帳號')} description={t('新增 Codex 或 Claude 帳號，完成登入後重新整理。')} />}
      <Stack gap="none">
        {value.accounts.map(account => <Box key={account.id} paddingY="md" gap="sm">
          <Row align="center" gap="sm">
            <Box grow minWidth={0} gap="xs">
              <Text weight="medium" truncate>{account.label}</Text>
              {account.identityLabel && account.identityLabel !== account.label && <Text muted size="sm" truncate>{account.identityLabel}</Text>}
            </Box>
            <Badge>{account.kind === 'api' ? 'API' : account.provider === 'pi' ? 'Pi' : account.provider === 'claude' ? 'Claude' : 'Codex'}</Badge>
            <IconButton variant="ghost" icon={read(editing) === account.id ? 'close' : 'edit'}
              label={`${t(read(editing) === account.id ? '取消編輯' : '編輯名稱')} (${account.label})`}
              disabled={pending} onPress={() => set(editing, read(editing) === account.id ? null : account.id)} />
          </Row>
          {account.disabledReason && <Text tone="warning" size="sm">{t(account.disabledReason)}</Text>}
          {read(editing) === account.id && <Stack gap="sm">
            <Input label={t('顯示名稱')} maxLength={40}
              value={read(drafts)[account.id] ?? (account.identityLabel && account.label !== account.identityLabel ? account.label : '')}
              placeholder={t('例如：工作、個人；留白恢復帳號名稱')} disabled={pending}
              onChange={name => set(drafts, { ...read(drafts), [account.id]: name })} />
            <Row justify="end" gap="sm" wrap>
              {account.provider === 'pi' && <Button variant="ghost" tone="danger" size="sm" disabled={pending} onPress={removePi}>{t('移除 Pi 入口')}</Button>}
              {account.kind === 'api' && <Button variant="ghost" tone="danger" size="sm" disabled={pending} onPress={() => removeApiProfile(account.id)}>{t('Remove API profile')}</Button>}
              <Button variant="outline" size="sm" disabled={pending || !(account.id in read(drafts))} onPress={() => rename(account.id)}>{t('儲存名稱')}</Button>
            </Row>
          </Stack>}
        </Box>)}
      </Stack>
    </Stack>}
  </Stack>
}
