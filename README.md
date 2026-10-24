# 循证 Trace

像 Git 一样调查，让结论有迹可循。为 WaytoAGI 1024 侦探赛道制作的网页原型。

## 已实现

- 输入文字、网页链接或截图，生成 2–6 步调查计划；可编辑查询词。
- TokLens 兼容 API 计划拆解；视觉模型单独配置。未配置时明确使用规则模板。
- 腾讯云元宝 SearchPro 真实接口适配，支持服务 API Key 和腾讯云 TC3 签名两种鉴权。每次点击检索只发起一次请求，不自动重试；未配置密钥时返回空结果。
- 官方与机构、新闻媒体、小红书、B 站和全网来源范围；按结果实际域名再次过滤。单选小红书或 B 站使用 Site 参数。
- Git 式提交图、从历史节点创建分支、切换分支、双父节点合并与证据可达性。
- 可点击原文、人工标记支持/反驳/背景、手动收录资料、Markdown 报告。
- 浏览器本地保存、JSON 备份和严格导入校验。当前没有跨设备同步。
- 文字调查室：新建问题、编号选择来源、逐步检索和查看报告。
- 微信公众号明文回调验签与即时菜单接口。实际微信搜索尚需持久会话与异步回复服务。

## 本地启动

需要 Node.js 22.13 或以上版本。所有源码与文档使用 UTF-8。

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
npm install
npm run dev
```

打开终端打印的地址，默认 http://127.0.0.1:5173/ 。无密钥也可以体验示例图谱、模板计划、分支、证据收录与报告。

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

腾讯云密钥所属账号需已开通元宝搜索并具有调用权限。TC3 模式不使用 `YUANBAO_SEARCH_ENDPOINT`，仍兼容原有服务 API KEY 方式；两种方式都不会自动重试。

TokLens 手册的文字示例为 `deepseek-v4.1-flash`；是否可用以你的 Key 权限及模型列表为准。文字模型不保证识别图片。图片只在计划请求中发送给配置的视觉模型，不保存进档案。

网页链接目前用于保留出处，不自动抓取页面正文。输入链接时请补充原文；后续可接正文提取服务。平台检索只能覆盖公开且被索引的内容。“官方与机构”由 `lib/server/sources.ts` 的域名及政府/教育域名规则识别；未识别的品牌官网可用“全网补充”并人工核查。

## 接口

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/status` | GET | 返回配置状态，不验证账户额度，不泄露密钥 |
| `/api/plan` | POST | `{ input, url?, image?, sources }` → 计划、模式与提示 |
| `/api/search` | POST | `{ query, sources, stepId?, limit? }` → 来源列表、实际调用次数与 RequestId |
| `/api/chat` | POST | `{ message, session? }` → `{ reply, session, mode }` |
| `/api/wechat` | GET/POST | 明文回调校验与菜单；未配置返回明确错误 |

模型只生成计划，不能生成伪造来源。搜索摘要是线索，结果默认标记“补充背景”；人工判断关系后再对照原文。检索相关性分数不用于显示真伪概率。当前报告为结构化证据记录，不会自动宣布某条主张已被证实。

## 微信接入路线

第一版在网页「文字调查室」体验指令：

```text
新建 长城能从月球上肉眼看见吗？
来源 1,2
下一步
报告
```

`1` 官方与机构、`2` 新闻、`3` 小红书、`4` B 站、`5` 全网。模拟会话只保留在当前页面。

公众号回调要求快速响应。当前 `/api/wechat` 仅验签并立即回复菜单，不在回调内运行模型。正式接入还需 MsgId 去重、持久化会话、异步任务、结果拉取或客服消息回复，以及微信可访问的回调地址。默认私有托管站点有登录边界，不能直接当作微信公网回调。

第二阶段可用企业微信官方智能机器人长连接：BotID/Secret 加独立 Node 服务，再调用这套调查接口；需要单独部署常驻 WebSocket 进程。Cloudflare Worker 网页版本不作为该常驻进程。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

测试采用模拟上游响应，覆盖真实请求格式、来源域名、错误脱敏、导入环检测及分支证据隔离，不消耗付费额度。真实模型、搜索及微信尚需你配置凭证后联调。

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
