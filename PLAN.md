# imp-write v1 实施计划

> 本文档自包含，面向在本仓库单独开启的 Claude Code 会话执行。所有引用的兄弟项目都在 `~/code/web/` 下，可直接读取参考。

## 1. 背景与定位

imp-write 是一个浏览器扩展：在**任意网页输入框内**用命令改写文本 —— 用户输入文字后追加 `?fix` / `?improve` / `?shorten` 或自定义命令并触发，AI 处理后**就地替换**原文。

- 起源：Discord 用户请求（对标 ShortcutAI，但 ShortcutAI 订阅制且不支持自带 API key —— 这就是市场缺口）。
- 定位：**双轨免费/付费** —— BYOK（自带 OpenAI 兼容端点 + key，完全免费）+ Imp Credits 托管积分（一键连接、装完即用，见 §6）。
- 家族：rxliuli 扩展家族成员（imp-translate / input-translator / bilingualtube），命名模式 `imp-{动词}`。商店 listing 建议：`Imp Write — AI fix & rewrite in any textbox`。

## 2. 已定决策（不要重新讨论）

| 决策 | 内容 |
|---|---|
| 范围纪律 | v1 只做纯 `<input>`/`<textarea>` + 尽力而为的 contenteditable；**明确不承诺** Google Docs/Notion 等 canvas/深度编辑器（README 写明）；不做移动端 |
| Provider | 只支持 OpenAI 兼容 `/chat/completions`（Gemini 走它的 OpenAI 兼容端点，天然覆盖）；不引 AI SDK，裸 fetch |
| BYOK 多 key | 支持配置多个 API key，请求失败（429/5xx）自动切下一个 —— 这是 Discord 需求方的头号诉求，也是对 ShortcutAI 的差异化 |
| 响应模式 | 非流式（替换是原子动作，流式打字机效果对输入框场景是负资产） |
| 版本号 | 0.x 阶段只递增 patch（用户纪律，勿升 minor） |
| 配置哲学 | 选一条最好的路，不开配置开关；警惕设置面膨胀 |
| UI 组件 | 定制 shadcn 组件放 `components/extra/` 直接 fork，`components/ui/` 保持纯原装 |

## 3. 参考项目（按价值排序，动手前先读）

### input-translator（`~/code/web/input-translator`）— 最重要
它就是"在输入框里检测触发 → 调 AI → 替换文本"，与 imp-write 机制几乎同构：
- `lib/UniversalSpaceDetector.ts` — **三连空格触发器**，桌面 keydown + 移动端 beforeinput 双路径、超时窗口计数，经过实战。imp-write 的触发机制直接复用/改造它（见 §4.1）。
- `lib/settings.ts` — 扁平 Settings（`{engine, apiKey, model, baseUrl, prompt}`）+ `getDefaultSettings()` 模式，存 `browser.storage.sync`。
- `lib/translate/openai.ts` — 裸 fetch 调 OpenAI 兼容端点，按模型名分流 `/responses` vs `/chat/completions`。
- `lib/selection.ts` / `lib/loading.ts` — 活动元素判定、输入框内 loading 状态呈现。**文本写回输入框的机制（含 React 受控组件兼容）以此项目的实现为准**，不要自己发明。
- `lib/messaging.ts` — `@webext-core/messaging` 的 content ↔ background 通信模式（imp-write 的 package.json 已带同款依赖）。

### imp-translate（`~/code/web/imp-translate`）
- `lib/storage.ts` — 另一种 settings 形状（嵌套 `openai: {apiKey, baseUrl, model, systemPrompt}`）+ 版本迁移写法。
- `lib/interceptors.ts` — per-provider 请求改写钩子（禁 thinking、DeepSeek/Gemini 特判）。BYOK 用户连 Gemini 原生端点时可能需要。

### imp-credits（`~/code/web/imp-credits`）— 托管积分服务
代码已完成（81/81 测试）但**尚未部署**。connect 契约见 §6；本地联调：在该仓库 `pnpm dev`（wrangler dev，有 `.dev.vars` 的 dev-login 可免 OTP 造账号）。

## 4. 核心功能规格

### 4.1 触发机制
- 命令 token：可配置前缀（默认 `?`）+ 命令名，出现在输入内容**末尾**（如 `帮我看看这段话对不对 ?fix`）。
- 激活手势：**命令 token 后三连空格**，复用 `UniversalSpaceDetector`（家族肌肉记忆一致，移动端 beforeinput 路径白送）。检测到激活时：解析末尾 token → 命中已定义命令才执行，否则不动（避免误触发）。
  > 2026-08-22 变更：激活手势由"命令 token 后三连空格"改为"输入命令 token 后停顿约 0.8s 自动触发"（用户决策）；undo 仅保留 Esc。
  > 2026-08-22 再变更：停顿阈值 0.8s→0.3s（手测反馈）；触发前缀固定为 ?，不再可配；站点黑名单暂时移除（§4.4 的第③④块随之取消）。
  > 2026-08-22 增量：内置 tl（译英）；右键菜单（contextMenus，editable 上下文）+ 选区级处理；命令快捷键（页面内监听，VSCode 式录制，存 settings.shortcuts）；多 provider 暂缓。
  > 2026-08-22 再修：失焦写回改为"等待重新聚焦后再写"（保住原生撤销栈与 React 兼容）；强制纠正降为极端兜底且改走 native setter + input 事件。
  > 2026-08-22 定稿：前缀改 /；去掉 token 前置空白要求（武装模型已防粘贴/URL）；内置命令种子化进 settings.commands（可改可删，Restore defaults 恢复）；失焦写回的两轮修复（校验纠正/等待聚焦）均因副作用回退，接受"切标签页可能追加"为已知限制（Esc 可还原），输入框可编辑性优先。
- 执行范围 v1：**整个输入框内容**（去掉命令 token 后作为 `{{text}}`）。选区级处理不做。

### 4.2 命令系统
- 内置：`fix`（改语法拼写标点，保持原语言）、`improve`（润色）、`shorten`（缩短精简）。prompt 参考 input-translator `lib/settings.ts` 里 Prompt 常量的写法（只输出结果、不加解释、保留不该动的内容）。
- 自定义：`{name, prompt}` 无限量，prompt 模板变量 `{{text}}`。存 settings。
- 输出即替换：AI 返回后整体写回输入框（写回机制照抄 input-translator）；写回前把原文存内存，替换后再次三连空格或 Esc 可还原（简单 undo，别依赖浏览器原生 undo 栈的跨框架行为）。

> 2026-08-22 增量：Restore 收进 Commands 区溢出菜单；新增命令集 Export/Import（仅 commands、version 1、merge 同名跳过、不含任何凭据）。

### 4.3 Provider 配置（settings 形状）
```ts
interface ProviderSettings {
  mode: 'imp' | 'byok'
  // imp 模式：connect 流程自动填充，用户不可见细节
  // byok 模式：
  baseUrl: string          // 默认 https://api.openai.com/v1
  apiKeys: string[]        // 多 key，请求 429/5xx 时按序切换重试（每 key 最多试 1 次）
  model: string
}
```
- AI 调用放 **background**（service worker）执行，content script 只发消息 —— key 不进页面世界，也绕开页面 CSP。
- 失败切换只针对 BYOK 多 key；imp 模式单 key 直连，服务端自己兜底。

> 2026-08-22 变更：BYOK 简化为单 API key（input password + Test connection 按钮），放弃多 key failover（§2/§4.3 的多 key 决策作废）。

> 2026-08-22 补齐：per-provider 请求钩子（`lib/interceptors.ts`，照搬 imp-translate，压掉 OpenAI gpt-5/Gemini/DeepSeek 的推理开销）。

### 4.4 设置页（options page，家族 React + Tailwind + shadcn 惯例）
四块，不再多：① 连接 Imp 账号（大按钮，见 §6）/ BYOK 高级配置（折叠）；② 命令管理（内置只读展示 + 自定义 CRUD）；③ 触发前缀配置；④ 站点黑名单（在某些站禁用检测）。

## 5. 架构落点（WXT，骨架已就位）

- `entrypoints/content/` — 主内容脚本（`<all_urls>`）：触发检测 + 文本读写 + loading 呈现。
- `entrypoints/imp-connect.content.ts` — **窄匹配** `https://imp.rxliuli.com/connect/success*` 的独立内容脚本，只做一件事：读 meta 标签 → sendMessage（见 §6）。
- `entrypoints/background.ts` — AI 请求、多 key 切换、connect 兑换。
- `lib/` — settings / commands / trigger（改造的 detector）/ ai-client，纯逻辑全部配 vitest 单测。
- extport 集成（`extport.config.json` 已在骨架里）保持家族惯例即可。

## 6. Imp Credits connect 契约（已定稿，服务端已实现并测试）

1. 设置页「Connect」按钮 → `browser.tabs.create({ url: 'https://imp.rxliuli.com/connect?src=imp-write' })`。
2. 用户在该页登录（邮箱 OTP）并点确认 → 服务端渲染 `/connect/success` 页面，一次性 code 只存在于 `<meta name="imp-connect-code" content="...">`（绝不在 URL）。
3. `imp-connect.content.ts`（窄匹配 success 页）读取 meta → `sendMessage` 给 background。
4. background `POST https://imp.rxliuli.com/connect/exchange`，body `{code}`（code 即凭证，无需其他认证，5 分钟 TTL、单次使用）→ 返回 `{apiKey, baseUrl, model}` → 写入 settings（`mode: 'imp'`），通知 success 页标签可关闭。
5. 服务未部署期间：baseUrl 域名做成可配置常量，本地联调指向 wrangler dev 地址；imp-credits 的 `GET /auth/dev-login?subject=xxx`（仅 .dev.vars 开启时存在）可快速造测试账号。
6. 计费相关错误透传：`402` = 余额不足（提示去 `https://imp.rxliuli.com/buy` 充值）、`429` = 限流（提示稍后再试）。

## 7. v1 明确不做

Google Docs/Notion 等 canvas 编辑器承诺、移动端、流式替换、选区级改写、多 provider 适配器（OpenAI 兼容以外）、i18n 之外的语言检测魔法、prompt 市场/分享。

## 8. 建议实施顺序与验证

1. **触发 + 替换内核**（先纯 input/textarea）：detector 改造 + 命令解析 + 写回。vitest 覆盖解析/切换逻辑；`pnpm dev` 在真实站点手测。
2. **AI 管线**：background 调用 + 多 key 切换 + 错误呈现（输入框内短暂提示，参考 input-translator loading 模式）。
3. **设置页** 四块 + 命令 CRUD。
4. **contenteditable 尽力而为**：Discord/X 编辑器手测，能用则用，不能用不阻塞发布。
5. **connect 流程**：对 wrangler dev 本地联调全链路。
6. 手测矩阵（发布前）：Gmail 撰写、X/Twitter 发帖框、GitHub textarea、Discord 输入框、一个 React 受控表单站点；每处验证：触发 → 替换 → undo → 站点黑名单生效。

## 9. 坑与注意

- React 受控输入写回必须走 native setter + input 事件（input-translator 已解决，抄它）。
- `<all_urls>` 会触发商店更严审核与吓人权限提示 —— listing 文案要解释清楚用途；connect 内容脚本务必窄匹配，不要偷懒并进主脚本的 matches。
- 三连空格检测注意 IME 组合输入（中文输入法组合期间的空格不应计数 —— 检查 detector 对 composition 事件的处理，不足则补）。
- 营销措辞不写"轮换免费 key 绕限流"，多 key 只表述为"reliability/failover"。
