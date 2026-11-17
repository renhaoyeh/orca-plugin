const messages = {
  '新增 Pi': ['Add Pi', '添加 Pi'],
  'Pi 已加入，點選底部狀態列即可開啟。': ['Pi added. Click Pi in the status bar to launch it.', 'Pi 已添加，点击底部状态栏即可打开。'],
  '移除 Pi 入口': ['Remove Pi entry', '移除 Pi 入口'],
  'Pi 入口已移除，現有分頁與登入不受影響。': ['Pi entry removed. Existing tabs and sign-in are unchanged.', 'Pi 入口已移除，现有标签页与登录不受影响。'],
  '用 {name} 開啟 Pi 對話': ['Open a Pi chat as {name}', '使用 {name} 打开 Pi 对话'],
  'Agent 帳號': ['Agent Accounts', 'Agent 账号'],
  '新增 Codex 帳號': ['Add Codex', '添加 Codex'],
  '新增 Claude 帳號': ['Add Claude', '添加 Claude'],
  '登入終端已開啟，完成登入後請重新整理帳號清單。': ['Sign-in terminal opened. Refresh the account list after signing in.', '登录终端已打开，完成登录后请刷新账号列表。'],
  '點選底部狀態列項目即可啟動 Agent。': ['Click a status-bar entry to start an agent.', '点击底部状态栏项目即可启动 Agent。'],
  '尚無帳號': ['No accounts yet', '尚无账号'],
  '新增 Codex 或 Claude 帳號，完成登入後重新整理。': ['Add a Codex or Claude account, then refresh after signing in.', '添加 Codex 或 Claude 账号，完成登录后刷新。'],
  '用 {name} 開啟 Claude 終端': ['Open a Claude terminal as {name}', '使用 {name} 打开 Claude 终端'],
  '點選底部狀態列的帳號即可開啟 Codex。': ['Click an account in the status bar to open Codex.', '点击底部状态栏的账号即可打开 Codex。'],
  '編輯名稱': ['Edit name', '编辑名称'],
  '取消編輯': ['Cancel editing', '取消编辑'],
  '目前工作區': ['Current workspace', '当前工作区'],
  '帳號清單': ['Accounts', '账号列表'],
  '管理帳號': ['Manage account', '管理账号'],
  '終端與權限說明': ['Terminal & permissions', '终端与权限说明'],
  '新增 API 金鑰設定檔': ['Add API key profile', '添加 API 密钥配置'],
  '設定檔名稱': ['Profile name', '配置名称'],
  '儲存 API 設定檔': ['Save API profile', '保存 API 配置'],
  '移除 API 設定檔': ['Remove API profile', '移除 API 配置'],
  '使用 OpenAI API 計費，不使用 ChatGPT 訂閱額度。Pro 贈送的 API credits 不適用於 Codex。': ['Uses paid OpenAI API billing, not your ChatGPT subscription. Pro bonus API credits do not cover Codex.', '使用 OpenAI API 计费，不使用 ChatGPT 订阅额度。Pro 赠送的 API credits 不适用于 Codex。'],
  '由 Orca 加密儲存。儲存不會驗證金鑰或發出付費請求。': ['Stored encrypted by Orca. Saving does not validate the key or make a billable request.', '由 Orca 加密保存。保存不会验证密钥或发出付费请求。'],
  'API 設定檔已儲存，未發出 API 請求。': ['API profile saved. No API request was made.', 'API 配置已保存，未发出 API 请求。'],
  'API 設定檔已移除，既有終端不受影響。': ['API profile removed. Existing terminals are unchanged.', 'API 配置已移除，现有终端不受影响。'],
  '加密儲存無法使用，API 金鑰未儲存。': ['Encrypted credential storage is unavailable. API key was not saved.', '加密存储不可用，API 密钥未保存。'],
  '無法儲存 API 設定檔，未保留 API 金鑰。': ['Could not save the API profile. No API key was retained.', '无法保存 API 配置，未保留 API 密钥。'],
  '找不到 API 金鑰，請移除此設定檔並重新新增。': ['API key is missing. Remove this profile and add it again.', '找不到 API 密钥，请移除此配置并重新添加。'],
  '請輸入 1 到 40 個字的設定檔名稱。': ['Enter a profile name (1–40 characters).', '请输入 1 到 40 个字符的配置名称。'],
  '請輸入不含空白或換行的有效 API 金鑰。': ['Enter a valid API key without spaces or line breaks.', '请输入不含空格或换行的有效 API 密钥。'],
  '重新整理': ['Refresh', '刷新'],
  '選擇帳號，在目前工作區開啟獨立終端。': ['Choose an account to open a terminal in this workspace.', '选择账号，在当前工作区打开独立终端。'],
  '無法完成': ['Could not complete', '无法完成'],
  '讀取帳號': ['Loading accounts', '读取账号'],
  '工作區：': ['Workspace: ', '工作区：'],
  '尚無 Codex 帳號': ['No Codex accounts', '尚无 Codex 账号'],
  '請先在 Orca 設定新增 Codex 帳號，再重新整理。': ['Add a Codex account in Orca settings, then refresh.', '请先在 Orca 设置添加 Codex 账号，再刷新。'],
  '開啟 Codex 終端': ['Open Codex terminal', '打开 Codex 终端'],
  '自訂名稱': ['Custom name', '自定义名称'],
  '顯示名稱': ['Display name', '显示名称'],
  '例如：工作、個人；留白恢復帳號名稱': ['Work, Personal… Leave blank to use the account name.', '例如：工作、个人；留空恢复账号名称'],
  '儲存名稱': ['Save name', '保存名称'],
  '顯示名稱已儲存。': ['Display name saved.', '显示名称已保存。'],
  '已建立 Codex 終端分頁。若顯示 Hooks need review，請在終端自行選擇審查或略過。': ['Codex terminal created. If you see “Hooks need review”, review or skip them in the terminal.', '已创建 Codex 终端标签页。若显示 Hooks need review，请在终端自行选择审查或跳过。'],
  'Windows 本機帳號限定。每個終端使用所選帳號的獨立環境，不切換預設帳號。這是終端模式，使用 Codex 自己的權限提示。': ['Local Windows accounts only. Each terminal uses its own account without switching the default. Codex handles permission prompts.', '仅限 Windows 本地账号。每个终端使用所选账号的独立环境，不切换默认账号。权限提示由 Codex 处理。'],
  '請先開啟一個工作區。': ['Open a workspace first.', '请先打开一个工作区。'],
  '第一版只支援本機 Windows 工作區。': ['Only local Windows workspaces are supported.', '仅支持 Windows 本地工作区。'],
  '名稱最多 40 個字，不能包含換行。': ['Names must be at most 40 characters and contain no line breaks.', '名称最多 40 个字符，不能包含换行。'],
  '帳號已不存在，請重新整理。': ['This account no longer exists. Refresh the account list.', '账号已不存在，请刷新。'],
  '這個帳號已不存在，請重新整理帳號列表。': ['This account no longer exists. Refresh the account list.', '此账号已不存在，请刷新账号列表。'],
  '正在開啟，請稍候。': ['An agent is opening. Please wait.', '正在打开，请稍候。'],
  '工作區已切換，請重新整理後再開啟。': ['The workspace changed. Refresh before launching.', '工作区已切换，请刷新后再打开。'],
  '這個版本只支援 Windows。': ['This version supports Windows only.', '此版本仅支持 Windows。'],
  '找不到 Orca 的本機資料夾或 CLI。': ['Orca’s local data directory or CLI could not be found.', '找不到 Orca 的本地数据目录或 CLI。'],
  'Orca 未回傳有效的帳號清單。': ['Orca did not return a valid account list.', 'Orca 未返回有效的账号列表。'],
  'Orca 帳號 ID 格式不符，已停止載入。': ['Unexpected Orca account ID format. Loading stopped.', 'Orca 账号 ID 格式不符，已停止加载。'],
  '尚未支援 WSL 帳號。': ['WSL accounts are not supported yet.', '尚未支持 WSL 账号。'],
  '無法呼叫 Orca CLI，請確認 Orca 正在執行。': ['Could not call Orca CLI. Check that Orca is running.', '无法调用 Orca CLI，请确认 Orca 正在运行。'],
  '無法解析 Orca 帳號清單。': ['Could not parse Orca’s account list.', '无法解析 Orca 账号列表。'],
  '找不到可讀取的登入檔，請在 Orca 重新登入。': ['Sign-in file unavailable. Sign in again through Orca.', '找不到可读取的登录文件，请在 Orca 重新登录。'],
  '無效的帳號資料夾。': ['Invalid account directory.', '无效的账号目录。'],
  'Orca 沒有回傳終端分頁，請先查看現有終端，避免重複開啟。': ['Orca returned no terminal tab. Check existing terminals before retrying.', 'Orca 未返回终端标签页，请先查看现有终端，避免重复打开。'],
  '用 {name} 開啟 Codex 終端': ['Open a Codex terminal as {name}', '使用 {name} 打开 Codex 终端'],
}

export function localeOf(locale) {
  const value = String(locale || '').toLowerCase().replaceAll('_', '-')
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(value)) return 'zh-TW'
  if (/^zh(-|$)/.test(value)) return 'zh-CN'
  return 'en'
}

export function text(source, locale = 'en', values = {}) {
  const key = messages[source] ? source : Object.keys(messages).find(key => messages[key][0] === source || messages[key][1] === source)
  const language = localeOf(locale)
  let result = key ? language === 'zh-TW' ? key : messages[key][language === 'zh-CN' ? 1 : 0] : source
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, String(value))
  return result
}
