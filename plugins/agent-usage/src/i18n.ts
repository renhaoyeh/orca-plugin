const messages: Record<string, [string, string]> = {
  'Agent Usage': ['帳號用量', '账号用量'],
  'Refresh usage': ['重新讀取用量', '重新读取用量'],
  'System default': ['系統預設帳號', '系统默认账号'],
  'Active': ['使用中', '使用中'],
  '5 hours': ['5 小時', '5 小时'],
  'Daily': ['每日', '每日'],
  'Weekly': ['每週', '每周'],
  'Fable weekly': ['Fable 每週', 'Fable 每周'],
  'Monthly': ['每月', '每月'],
  'Session': ['目前時段', '当前时段'],
  'Usage window': ['用量週期', '用量周期'],
  'No account usage available': ['目前沒有可顯示的帳號用量', '目前没有可显示的账号用量'],
  'No usage reported yet.': ['Orca 尚未回報用量。', 'Orca 尚未报告用量。'],
  'Orca is checking usage…': ['Orca 正在查詢用量…', 'Orca 正在查询用量…'],
  'Usage is unavailable.': ['目前無法取得用量。', '目前无法获取用量。'],
  'Sign in again in Orca Accounts.': ['請在 Orca 的帳號設定中重新登入。', '请在 Orca 的账号设置中重新登录。'],
  'Could not read usage from the Orca CLI.': ['無法從 Orca CLI 讀取用量。', '无法从 Orca CLI 读取用量。'],
  'Orca did not return usage data.': ['Orca 未回傳用量資料。', 'Orca 未返回用量数据。'],
  'Loading account usage': ['正在讀取帳號用量', '正在读取账号用量'],
  'Last checked': ['上次查詢', '上次查询'],
  'Show remaining quota': ['切換成剩餘額度', '切换成剩余额度'],
  'Show used quota': ['切換成已使用', '切换成已使用'],
  'Remaining': ['剩餘額度', '剩余额度'],
  'Used': ['已使用', '已使用'],
}

export function translate(key: string, locale: string) {
  const entry = messages[key]
  const [language, region] = locale.toLowerCase().replaceAll('_', '-').split('-')
  if (!entry || language !== 'zh') return key
  return entry[['hant', 'tw', 'hk', 'mo'].includes(region) ? 0 : 1]
}
