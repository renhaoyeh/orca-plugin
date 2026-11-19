const messages = new Map([
  ['Git Identity', { 'zh-TW': 'Git 身分', 'zh-CN': 'Git 身份' }],
  ['Refresh identity', { 'zh-TW': '重新整理 Git 身分', 'zh-CN': '刷新 Git 身份' }],
  ['Could not complete', { 'zh-TW': '無法完成', 'zh-CN': '无法完成' }],
  ['Reading Git identity', { 'zh-TW': '正在讀取 Git 身分', 'zh-CN': '正在读取 Git 身份' }],
  ['GitHub account', { 'zh-TW': 'GitHub 帳號', 'zh-CN': 'GitHub 账号' }],
  ['Reading gh accounts…', { 'zh-TW': '正在讀取 gh 帳號…', 'zh-CN': '正在读取 gh 账号…' }],
  ['Choose a gh account', { 'zh-TW': '選擇 gh 帳號', 'zh-CN': '选择 gh 账号' }],
  ['You can still enter an author manually.', { 'zh-TW': '你仍可手動輸入作者資訊。', 'zh-CN': '你仍可手动输入作者信息。' }],
  ['No gh accounts found. Run gh auth login, then refresh.', { 'zh-TW': '找不到 gh 帳號。請執行 gh auth login，再重新整理。', 'zh-CN': '找不到 gh 账号。请运行 gh auth login，然后刷新。' }],
  ['Push settings were changed externally. Refresh or inspect Git config; the plugin will not overwrite them.', { 'zh-TW': '推送設定已從外部變更。請重新整理或檢查 Git 設定。外掛會保留這些設定。', 'zh-CN': '推送设置已在外部更改。请刷新或检查 Git 配置。插件会保留这些设置。' }],
  ['Name', { 'zh-TW': '姓名', 'zh-CN': '姓名' }],
  ['Email', { 'zh-TW': '電子郵件', 'zh-CN': '电子邮箱' }],
  ['A worktree or command-level setting overrides the repository. Resolve that override before saving.', { 'zh-TW': '工作樹或命令層級的設定覆蓋了儲存庫設定，請先處理再儲存。', 'zh-CN': '工作树或命令级设置覆盖了仓库设置，请先处理再保存。' }],
  ['Identity environment variables are set in the worker. They can override Git config; other terminals may have different overrides.', { 'zh-TW': '外掛程序已設定身分環境變數，可能覆蓋 Git 設定。其他終端也可能有不同設定。', 'zh-CN': '插件进程已设置身份环境变量，可能覆盖 Git 配置。其他终端也可能有不同设置。' }],
  ['Saving…', { 'zh-TW': '儲存中…', 'zh-CN': '正在保存…' }],
  ['Save', { 'zh-TW': '儲存', 'zh-CN': '保存' }],
  ['Default', { 'zh-TW': '預設', 'zh-CN': '默认' }],
  ['unavailable', { 'zh-TW': '無法使用', 'zh-CN': '不可用' }],
  ['Account switched.', { 'zh-TW': '已切換帳號。', 'zh-CN': '已切换账号。' }],
  ['No public email. Enter your commit email below.', { 'zh-TW': '此帳號未公開電子郵件，請在下方輸入提交用的地址。', 'zh-CN': '此账号未公开电子邮箱，请在下方输入提交使用的地址。' }],
  ['Account switched, but the profile could not be loaded.', { 'zh-TW': '已切換帳號，無法載入個人資料。', 'zh-CN': '已切换账号，无法加载个人资料。' }],
  ['Using default Git settings.', { 'zh-TW': '目前使用預設 Git 設定。', 'zh-CN': '当前使用默认 Git 设置。' }],
  ['Saved.', { 'zh-TW': '已儲存。', 'zh-CN': '已保存。' }],
  ['Set identity', { 'zh-TW': '設定身分', 'zh-CN': '设置身份' }],
  ['Unavailable', { 'zh-TW': '無法使用', 'zh-CN': '不可用' }],
  ['(unset)', { 'zh-TW': '（未設定）', 'zh-CN': '（未设置）' }],
  ['Open a local Git workspace first.', { 'zh-TW': '請先開啟本機 Git 工作區。', 'zh-CN': '请先打开本地 Git 工作区。' }],
  ['Only local Windows Git workspaces are supported.', { 'zh-TW': '僅支援本機 Windows Git 工作區。', 'zh-CN': '仅支持本地 Windows Git 工作区。' }],
  ['GitHub account is not available. Refresh the account list.', { 'zh-TW': '無法使用此 GitHub 帳號，請重新整理帳號清單。', 'zh-CN': '无法使用此 GitHub 账号，请刷新账号列表。' }],
  ['A save is already in progress. Please wait.', { 'zh-TW': '正在儲存，請稍候。', 'zh-CN': '正在保存，请稍候。' }],
  ['Workspace changed. Refresh before saving.', { 'zh-TW': '工作區已切換，請重新整理後再儲存。', 'zh-CN': '工作区已切换，请刷新后再保存。' }],
  ['GitHub account is unavailable. Refresh before binding.', { 'zh-TW': '無法使用此 GitHub 帳號，請重新整理後再綁定。', 'zh-CN': '无法使用此 GitHub 账号，请刷新后再绑定。' }],
  ['Could not read GitHub data. Check gh installation, network and gh auth login, then retry.', { 'zh-TW': '無法讀取 GitHub 資料。請檢查 gh 安裝、網路和 gh auth login 登入狀態，再重試。', 'zh-CN': '无法读取 GitHub 数据。请检查 gh 安装、网络和 gh auth login 登录状态，再重试。' }],
  ['Unexpected GitHub account response. Update gh and retry.', { 'zh-TW': 'GitHub 帳號回應格式不符。請更新 gh 後再試。', 'zh-CN': 'GitHub 账号响应格式异常。请更新 gh 后重试。' }],
  ['Invalid GitHub account.', { 'zh-TW': '無效的 GitHub 帳號。', 'zh-CN': '无效的 GitHub 账号。' }],
  ['GitHub profile does not match the selected account.', { 'zh-TW': 'GitHub 個人資料與所選帳號不符。', 'zh-CN': 'GitHub 个人资料与所选账号不匹配。' }],
  ['GitHub binding metadata is invalid. Inspect repository config before changing the binding.', { 'zh-TW': 'GitHub 綁定資料無效，請先檢查儲存庫設定。', 'zh-CN': 'GitHub 绑定数据无效，请先检查仓库配置。' }],
  ['Push settings were edited outside this plugin. Refusing to overwrite them.', { 'zh-TW': '推送設定已從外部變更，無法套用修改。', 'zh-CN': '推送设置已在外部更改，无法应用修改。' }],
  ['Git could not read or update this repository. Check Git installation, repository access and config locks.', { 'zh-TW': 'Git 無法讀取或更新此儲存庫。請檢查 Git 安裝、儲存庫權限與設定鎖定狀態。', 'zh-CN': 'Git 无法读取或更新此仓库。请检查 Git 安装、仓库权限和配置锁定状态。' }],
  ['Unexpected Git config response.', { 'zh-TW': 'Git 設定回應格式不符。', 'zh-CN': 'Git 配置响应格式异常。' }],
  ['Repository config must be a regular file, not a symbolic link.', { 'zh-TW': '儲存庫設定必須是一般檔案。', 'zh-CN': '仓库配置必须是普通文件。' }],
  ['Open a local Git working tree first.', { 'zh-TW': '請先開啟本機 Git 工作樹。', 'zh-CN': '请先打开本地 Git 工作树。' }],
  ['Git did not return an absolute config directory.', { 'zh-TW': 'Git 未回傳設定目錄的絕對路徑。', 'zh-CN': 'Git 未返回配置目录的绝对路径。' }],
  ['Enter a name and email without control characters or angle brackets.', { 'zh-TW': '請輸入不含控制字元或角括號的姓名和電子郵件。', 'zh-CN': '请输入不含控制字符或尖括号的姓名和电子邮箱。' }],
  ['Git identity or repository changed. Refresh before saving.', { 'zh-TW': 'Git 身分或儲存庫已變更，請重新整理後再儲存。', 'zh-CN': 'Git 身份或仓库已更改，请刷新后再保存。' }],
  ['A worktree or command-level identity overrides repository settings. Resolve that override before saving.', { 'zh-TW': '工作樹或命令層級的身分已覆蓋儲存庫設定，請先處理再儲存。', 'zh-CN': '工作树或命令级身份已覆盖仓库设置，请先处理再保存。' }],
  ['Git identity changed. Refresh before saving.', { 'zh-TW': 'Git 身分已變更，請重新整理後再儲存。', 'zh-CN': 'Git 身份已更改，请刷新后再保存。' }],
  ['Repository config changed. Refresh before saving.', { 'zh-TW': '儲存庫設定已變更，請重新整理後再儲存。', 'zh-CN': '仓库配置已更改，请刷新后再保存。' }],
  ['Git config is locked by another operation. Wait, then try again.', { 'zh-TW': '另一項操作已鎖定 Git 設定，請稍候再試。', 'zh-CN': '另一项操作已锁定 Git 配置，请稍后重试。' }],
])

export function localeOf(locale: string | undefined) {
  const tag = (locale || '').toLowerCase().replaceAll('_', '-')
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(tag)) return 'zh-TW'
  if (/^zh(-|$)/.test(tag)) return 'zh-CN'
  return 'en'
}

export function translate(source: string, locale: ReturnType<typeof localeOf>) {
  const entry = messages.get(source)
  return entry && locale !== 'en' ? entry[locale] : source
}
