# 循证 Trace

像 Git 一样调查，让结论有迹可循。为 WaytoAGI 1024 侦探赛道制作的网页原型。

## 已实现

- 输入文字、网页链接或截图，生成 2–6 步调查计划；可编辑查询词。
- TokLens 兼容 API 计划拆解；视觉模型单独配置。未配置时明确使用规则模板。
- 腾讯云元宝 SearchPro 真实接口适配，支持服务 API Key 和腾讯云 TC3 签名两种鉴权。每个步骤最多发起一次请求；一键调查每轮最多 6 次检索，不自动重试；未配置密钥时返回空结果。
- 官方与机构、新闻媒体、小红书、B 站和全网来源范围；按结果实际域名再次过滤。单选小红书或 B 站使用 Site 参数。
- Git 式提交图、从历史节点创建分支、切换分支、双父节点合并与证据可达性。
- 可点击原文、人工标记支持/反驳/背景、手动收录资料、Markdown 报告。
- 浏览器本地保存、JSON 备份和严格导入校验；登录后可显式保存到账号或取回云端档案。
- 独立账号密码注册与登录，服务端保存密码摘要与会话。公开访客每日可体验 2 次拆解、3 次检索，工作台和文字调查室共用额度。
- 账号截图查证：识别截图中的可核查主张，每条调用一次元宝搜索，再生成只引用本次真实资料的初步核对。无证据、无效引用或上游失败时明确保留未知，可导出报告。
- 账号持续盯梢：D1 保存 1、6 或 24 小时的复查任务，比较检索链接和标题/摘要指纹，保留基线、变化、错误、未读提醒与历史。后台调度独立于浏览器，见 `docs/后台盯梢调度.md`。
- 文字调查室：新建问题、编号选择来源、逐步检索和查看报告。
- 微信公众号明文回调验签与即时菜单接口。实际微信搜索尚需持久会话与异步回复服务。

## 自动收集线索

新建调查后，主按钮「拆解并自动调查」会先生成计划，再逐步搜索并自动收录标题、摘要、原文链接；不用逐条填写线索。也可选择「仅生成计划」先调整查询词和来源。

已有档案点击「一键调查」继续剩余步骤；已查过的相同查询会跳过，改过查询词的步骤可重新执行。每一步立即保存并选中新节点，重复 URL 会去重。

「暂停后续检索」会等待当前一步完成并保留结果，再停止后续请求。失败时停止，不自动重试。调查时保持页面打开；刷新后可点击继续，系统不会自行重启并消耗次数。「手动补充」用于加入额外找到的网页。

## 本地启动

需要 Node.js 22.13 或以上版本。所有源码与文档使用 UTF-8。

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
npm install
npm run dev
```

账号和访客额度使用 D1。首次启用或新增迁移后，先构建生成配置，再按顺序应用尚未执行的本地迁移：

```powershell
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_plain_iceman.sql
npm run dev
```

打开终端打印的地址，默认 http://127.0.0.1:5173/ 。无模型/搜索密钥时，示例图谱、模板计划、分支、手动证据与报告仍可使用；不会把模板冒充真实检索。

## 配置真实调用

将 `.env.example` 复制为 `.dev.vars`，在本机编辑密钥，重启开发服务。`.dev.vars` 已加入 Git 忽略。不要将密钥写入前端、截图或聊天记录。托管版通过 Sites 的服务端环境变量配置同名字段，部署后生效。

| 变量 | 用途 |
| --- | --- |
| `TOKLENS_API_KEY` | 该服务的模型 Key |
| `TOKLENS_BASE_URL` | DeepSeek/GLM/Grok：`https://hkg.toklens.ai/v1`；GPT/Codex：`https://lax.toklens.ai/v1` |
| `TOKLENS_MODEL` | 从控制台或 `/models` 确认的文字模型名 |
| `TOKLENS_VISION_MODEL` | 可选，确认支持聊天图片输入的视觉模型 |
| `YUANBAO_API_KEY` | 可选：元宝搜索服务 API KEY；与下面的腾讯云签名密钥二选一，有此项时优先使用 |
| `TENCENT_SECRET_ID` | 腾讯云签名方式的 SecretId，与 SecretKey 成对配置 |
| `TENCENT_SECRET_KEY` | 腾讯云签名方式的 SecretKey，仅限服务端 |
| `TENCENT_WSA_ENDPOINT` | 签名方式固定使用 `https://wsa.tencentcloudapi.com/`，不接受任意网关 |
| `YUANBAO_SEARCH_ENDPOINT` | 默认 `https://api.wsa.cloud.tencent.com/SearchPro`，可替换经确认兼容的端口 |
| `WECHAT_TOKEN` | 公众号明文回调校验 Token，可留空 |
| `MONITOR_RUNNER_TOKEN` | 后台复查入口的服务端鉴权值，同时用于签名匿名访客标识；仅服务端保存 |

腾讯云密钥所属账号需已开通元宝搜索并具有调用权限。TC3 模式不使用 `YUANBAO_SEARCH_ENDPOINT`，仍兼容原有服务 API KEY 方式；两种方式都不会自动重试。

文字模型是否可用以 Key 权限及模型列表为准，文字模型不保证识别图片。截图在计划或查证请求中发送给配置的视觉模型，后端不保存原图。

网页链接目前用于保留出处，不自动抓取页面正文。输入链接时请补充原文；后续可接正文提取服务。平台检索只能覆盖公开且被索引的内容。“官方与机构”由 `lib/server/sources.ts` 的域名及政府/教育域名规则识别；未识别的品牌官网可用“全网补充”并人工核查。

## 接口

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/status` | GET | 返回配置状态；可选 `?probe=1` 检查模型列表是否可达，不验证账户额度 |
| `/api/plan` | POST | `{ input, url?, image?, sources }` → 计划、模式与提示 |
| `/api/search` | POST | `{ query, sources, stepId?, limit? }` → 来源列表、实际调用次数与 RequestId |
| `/api/chat` | POST | `{ message, session? }` → `{ reply, session, mode }` |
| `/api/auth/me` | GET | 账号状态、访客剩余次数与签名匿名 Cookie |
| `/api/auth/register`、`/api/auth/login`、`/api/auth/logout` | POST | 独立账号注册、登录、退出；同源写请求 |
| `/api/cloud-cases` | GET/PUT | 当前账号的档案，服务端验证导入结构及归属 |
| `/api/check` | POST | 登录后提交 `{ image, input?, sources }`，返回主张、初步判断与实际引用 |
| `/api/monitors` | GET/POST | 当前账号的盯梢任务与未读数，或创建新任务 |
| `/api/monitors/[id]` | PATCH | 暂停、恢复、标记已读；只能操作自己的任务 |
| `/api/monitors/[id]/run` | POST | 手动建立基线或复查，保存实际 SearchPro RequestId |
| `/api/monitor-tick` | POST | 仅后台令牌可调用，每批最多复查 3 项到期任务 |
| `/api/wechat` | GET/POST | 明文回调校验与菜单；未配置返回明确错误 |

计划接口只拆题，来源由真实检索提供。普通工作台报告仍是证据记录；截图核对会基于检索摘要给出初步判断，并将引用约束在该主张实际搜到的资料内。两种流程都需要打开原文核读，不显示真伪概率，也不提供反向搜图、原图溯源或篡改鉴定。关系标签目前按同一档案共享，双父合并汇合全部可达资料，选择性采纳仍属后续方案。

盯梢检测的是检索结果变化，不能等同于网页正文变化或原文删除。每账号最多 3 项活动任务，全站每天最多 60 次盯梢复查，失败不即时重试。站内未读提醒会在返回网页时显示，当前没有微信或邮件推送。

## 微信接入路线

第一版在网页「文字调查室」体验指令：

```text
新建 长城能从月球上肉眼看见吗？
来源 1,2
下一步
报告
```

`1` 官方与机构、`2` 新闻、`3` 小红书、`4` B 站、`5` 全网。模拟会话只保留在当前页面。

公众号回调要求快速响应。当前 `/api/wechat` 仅验签并立即回复菜单，不在回调内运行模型。正式接入还需 MsgId 去重、持久化微信会话、异步任务、结果拉取或客服消息回复。站点目前公开可访问，账号高级功能使用作品自己的登录系统。

第二阶段可用企业微信官方智能机器人长连接：BotID/Secret 加独立 Node 服务，再调用这套调查接口；需要单独部署常驻 WebSocket 进程。Cloudflare Worker 网页版本不作为该常驻进程。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

自动化测试使用模拟上游与本机 SQLite，覆盖请求格式、错误脱敏、导入及分支、账号隔离、配额并发、监控租约和截图引用约束，不消耗付费额度。真实模型、搜索、后台复查和界面另以实际调用联调；微信正式搜索仍未接通。

## 参赛材料

- `docs/参赛方案.md`：产品定位、可行性、官方规则及后续规划。
- `docs/演示脚本.md`：三次真实查询模板与三分钟演示脚本。
- 官网截止：2026 年 10 月 25 日 16:00，需能打开的作品和三次真实查询演示。
- 示例档案有明确演示标签，不可冒充三次真实查询。获奖分享要求见官方赛道页。

## 依据

- [比赛赛道](https://1024.waytoagi.com/tracks/detective)
- [比赛规则](https://1024.waytoagi.com/rules)
- [TokLens 手册](https://toklens.ai/zh/manual)
- [元宝服务 API KEY 接入](https://cloud.tencent.com/document/product/1806/130615)
- [SearchPro 参数](https://cloud.tencent.com/document/api/1806/121811)
- [WaytoAGI 元宝接入指引](https://waytoagi.feishu.cn/wiki/FJnwwkI5sigAbKk5YvKcAkSKnAg)
- [公众号被动回复](https://developers.weixin.qq.com/doc/service/guide/product/message/Passive_user_reply_message.html)
- [企业微信智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)

用户提供的邀请码 `4UU3BC39` 可在官方流程自行核销，本项目没有执行领取。活动额度期限和兑换结果以腾讯云及主办方为准。
