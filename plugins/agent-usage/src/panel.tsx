import {
  atom, read, set, env, plugin, type PanelContext, Stack, Row, Heading, Text,
  Button, IconButton, Box, Badge, Image, Progress, RelativeTime, Skeleton, Callout, EmptyState,
} from 'orca'
import { providers, type Provider, type UsageRow, type UsageWindow } from './protocol'
import { translate } from './i18n'

const data = atom<UsageRow[] | null>(null)
const busy = atom(false)
const error = atom('')
const quotaDisplay = atom<'remaining' | 'used'>('quota-display.v1', 'remaining', { persist: 'plugin' })
let panelSignal: AbortSignal | undefined

async function load() {
  if (read(busy) || panelSignal?.aborted) return
  set(busy, true)
  set(error, '')
  const signal = panelSignal
  try {
    const rows = await plugin.request('usage.read', undefined, { signal })
    if (!signal?.aborted) set(data, rows)
  } catch (cause) {
    if (!signal?.aborted) {
      set(error, cause instanceof Error && cause.message === 'Orca did not return usage data.'
        ? cause.message : 'Could not read usage from the Orca CLI.')
    }
  } finally {
    if (!signal?.aborted) set(busy, false)
  }
}

export function setup(ctx: PanelContext) {
  panelSignal = ctx.signal
  void load()
}

function nameOf(row: UsageRow, index: number, total: number, t: (label: string) => string) {
  if (row.system) return t('System default')
  return row.label || (total > 1 ? `${providers[row.provider]} ${index + 1}` : providers[row.provider])
}

function nameOfWindow(window: UsageWindow, t: (label: string) => string) {
  if (window.kind === 'bucket') return window.label || t('Usage window')
  if (window.kind === 'weekly') return t('Weekly')
  if (window.kind === 'fableWeekly') return t('Fable weekly')
  if (window.kind === 'monthly') return t('Monthly')
  if (window.minutes === 300) return t('5 hours')
  if (window.minutes === 1440) return t('Daily')
  return t('Session')
}

function shortWindow(window: UsageWindow, name: string) {
  if (window.kind === 'bucket' || window.kind === 'fableWeekly') return name
  if (window.minutes === 300) return '5h'
  if (window.minutes === 1440) return '24h'
  if (window.minutes === 10080) return '7d'
  if (window.minutes === 43200) return '30d'
  return name
}

function planLabel(value: string) {
  if (value.toLowerCase() === 'prolite') return 'Pro Lite'
  return value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase())
}

const statusText = {
  unavailable: 'No usage reported yet.',
  loading: 'Orca is checking usage…',
  error: 'Usage is unavailable.',
  'sign-in': 'Sign in again in Orca Accounts.',
} as const

function ProviderIcon({ provider }: { provider: Provider }) {
  const base = provider === 'opencodeGo' ? 'opencode' : provider
  const theme = ['cursor', 'grok', 'opencode', 'zcode'].includes(base) ? `-${env.theme.colorScheme}` : ''
  return <Box width={16} shrink={false}><Image src={`assets/${base}${theme}.png`} size="xs" alt="" /></Box>
}

export default function Panel() {
  const locale = env.locale
  const t = (key: string) => translate(key, locale)
  const percentage = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const rows = (read(data) || []).filter(row => row.windows.length > 0)
  const pending = read(busy)
  const mode = read(quotaDisplay)
  const modeLabel = t(mode === 'used' ? 'Used' : 'Remaining')
  const groups = new Map<Provider, UsageRow[]>()
  for (const row of rows) {
    const group = groups.get(row.provider) || []
    group.push(row)
    groups.set(row.provider, group)
  }
  return <Stack gap="md">
    <Row align="center" justify="between" gap="sm" wrap>
      <Heading level={2}>{t('Agent Usage')}</Heading>
      <Row align="center" gap="xs">
        <Button size="sm" variant="outline" tooltip={t(mode === 'used' ? 'Show remaining quota' : 'Show used quota')}
          onPress={() => set(quotaDisplay, read(quotaDisplay) === 'used' ? 'remaining' : 'used')}>
          {`${modeLabel} ⇅`}
        </Button>
        <IconButton icon="refresh" label={t('Refresh usage')} variant="ghost" disabled={pending} onPress={load} />
      </Row>
    </Row>
    {read(error) && <Callout tone="danger">{t(read(error))}</Callout>}
    {pending && !read(data) && <Skeleton label={t('Loading account usage')} lines={5} />}
    {!pending && !read(error) && !rows.length && <EmptyState icon="gauge" title={t('No account usage available')} />}
    {[...groups].map(([provider, accounts]) => (
      <Stack key={provider} gap="sm">
        <Row align="center" gap="sm">
          <ProviderIcon provider={provider} />
          <Heading level={3}>{providers[provider]}</Heading>
        </Row>
        {accounts.map((row, index) => {
          const label = nameOf(row, index, accounts.length, t)
          const plan = planLabel(row.plan)
          const planNames = new Set([row.plan.toLowerCase(), plan.toLowerCase()])
          const detail = [row.system ? row.label : '', ...row.detail.split(' · ')]
            .filter(item => item && !planNames.has(item.toLowerCase())).join(' · ')
          return <Box key={row.key} padding="sm" paddingX="md" background="card" border radius="lg" gap="sm">
            <Box direction="row" align="center" justify="between" gap="sm">
              <Box minWidth={0} grow>
                <Box direction="row" align="center" justify="start" gap="sm">
                  <Text size="sm" weight="semibold" truncate>{label}</Text>
                  {plan && <Box maxWidth={80} shrink={false}><Text size="xs" muted truncate>{plan}</Text></Box>}
                </Box>
                {detail && <Text size="xs" muted truncate>{detail}</Text>}
              </Box>
              {row.active && <Badge tone="accent">{t('Active')}</Badge>}
            </Box>
            <Stack gap="xs">
              {row.status !== 'available' && <Text size="xs" muted>{t(statusText[row.status])}</Text>}
              {row.windows.map((window, index) => {
                const name = nameOfWindow(window, t)
                const value = mode === 'used' ? window.used : 100 - window.used
                const amount = percentage.format(value / 100)
                const tone = window.used >= 90 ? 'danger' : window.used >= 70 ? 'warning' : 'neutral'
                const longLabel = window.kind === 'bucket' || window.kind === 'fableWeekly'
                return <Stack key={`${name}:${index}`} gap="none">
                  {longLabel && <Text size="xs" muted>{name}</Text>}
                  <Row align="center" gap="xs">
                    {!longLabel && <Box width={34} shrink={false}><Text size="xs" muted truncate>{shortWindow(window, name)}</Text></Box>}
                    <Box grow minWidth={20}>
                      <Progress label={`${name} · ${modeLabel} ${amount}`} labelHidden value={value} />
                    </Box>
                    <Box width={44} shrink={false} align="end"><Text size="xs" weight="semibold" tone={tone}>{amount}</Text></Box>
                    <Box width={63} shrink={false} align="end">
                      <Text size="xs" muted truncate>{window.resetsAt > 0 ? <RelativeTime at={window.resetsAt} format="short" /> : '—'}</Text>
                    </Box>
                  </Row>
                </Stack>
              })}
              {row.checkedAt > 0 && row.status !== 'available' &&
                <Text size="xs" muted>{t('Last checked')} <RelativeTime at={row.checkedAt} format="short" /></Text>}
            </Stack>
          </Box>
        })}
      </Stack>
    ))}
  </Stack>
}
