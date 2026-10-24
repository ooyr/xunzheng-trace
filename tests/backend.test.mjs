import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = await importTypeScript(path.join(root, "lib/server/sources.ts"));
const http = await importTypeScript(path.join(root, "lib/server/http.ts"));
const planner = await importTypeScript(path.join(root, "lib/server/planner.ts"));
const search = await importTypeScript(path.join(root, "lib/server/search.ts"));
const wechat = await importTypeScript(path.join(root, "lib/server/wechat.ts"));
const chat = await importTypeScript(path.join(root, "lib/server/chat.ts"));

async function withEnv(values, run) {
  values = { TENCENT_SECRET_ID: undefined, TENCENT_SECRET_KEY: undefined, TENCENTCLOUD_SECRET_ID: undefined, TENCENTCLOUD_SECRET_KEY: undefined, TENCENT_WSA_ENDPOINT: undefined, ...values };
  const before = {};
  for (const [name, value] of Object.entries(values)) { before[name] = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return await run(); }
  finally { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

test("来源按真实域名筛选，拒绝伪装后缀与危险链接", () => {
  assert.equal(sources.allowedSource("https://www.nasa.gov/article/", ["official"]), "official");
  assert.equal(sources.allowedSource("https://www.nasa.gov.evil.example/article/", ["official"]), null);
  assert.equal(sources.allowedSource("https://space.bilibili.com/1", ["bilibili"]), "bilibili");
  assert.equal(sources.allowedSource("https://bilibili.com.evil.example/1", ["bilibili"]), null);
  assert.equal(sources.allowedSource("javascript:alert(1)", ["web"]), null);
  assert.equal(sources.allowedSource("http://127.0.0.1/secret", ["web"]), null);
  assert.equal(sources.allowedSource("https://user:pass@example.com/", ["web"]), null);
});

test("请求校验拒绝空来源、畸形图片与过大消息", async () => {
  assert.throws(() => planner.validatePlan({ input: "问题", sources: [] }), { code: "INVALID_SOURCES" });
  assert.throws(() => planner.validatePlan({ input: "问题", image: "data:text/html;base64,AAAA", sources: ["web"] }), { code: "INVALID_IMAGE" });
  assert.throws(() => search.validateSearch({ query: "问题", sources: ["web"], limit: 500 }), { code: "INVALID_LIMIT" });
  await assert.rejects(http.readJson(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "a".repeat(200) }) }), 30), { code: "BODY_TOO_LARGE" });
});

test("无模型密钥时仅返回模板，截图不被冒充为已识别", async () => {
  await withEnv({ TOKLENS_API_KEY: undefined, TOKLENS_MODEL: undefined, TOKLENS_VISION_MODEL: undefined }, async () => {
    let called = false;
    const plan = await planner.createPlan({ input: "长城从月球可见吗", image: "data:image/png;base64,AAAA", sources: ["official"] }, async () => { called = true; throw new Error("不应联网"); });
    assert.equal(called, false);
    assert.equal(plan.mode, "demo");
    assert.equal(plan.steps.length, 4);
    assert.match(plan.notice, /截图尚未识别/);
    assert.equal(plan.extractedText, undefined);
  });
});

test("模型响应失败会暴露明确脱敏错误，不静默降级成模板", async () => {
  await withEnv({ TOKLENS_API_KEY: "test-only-key", TOKLENS_MODEL: "model-from-provider", TOKLENS_BASE_URL: "https://hkg.toklens.ai/v1" }, async () => {
    await assert.rejects(planner.createPlan({ input: "问题", sources: ["official"] }, async () => new Response(JSON.stringify({ error: { message: "secret test-only-key" } }), { status: 401 })), error => error.code === "UPSTREAM_ERROR" && !error.message.includes("test-only-key"));
  });
});

test("模型只负责生成计划，返回步骤被约束到用户选定来源", async () => {
  await withEnv({ TOKLENS_API_KEY: "test-only-key", TOKLENS_MODEL: "provider-model", TOKLENS_BASE_URL: "https://hkg.toklens.ai/v1" }, async () => {
    let sent;
    const result = await planner.createPlan({ input: "待查说法", sources: ["official"] }, async (url, options) => {
      assert.equal(url, "https://hkg.toklens.ai/v1/chat/completions");
      sent = JSON.parse(options.body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "核查说法", steps: [1, 2].map(index => ({ title: `步骤${index}`, description: "查找一手资料", query: "检索词", sources: ["bilibili"] })) }) } }] });
    });
    assert.equal(sent.model, "provider-model");
    assert.match(sent.messages[0].content, /不编造事实/);
    assert.equal(result.mode, "live");
    assert.deepEqual(result.steps[0].sources, ["official"]);
  });
});

test("无搜索密钥时返回空结果，且不消耗次数", async () => {
  await withEnv({ YUANBAO_API_KEY: undefined, YUANBAO_SEARCH_API_KEY: undefined, TENCENTCLOUD_WSA_APIKEY: undefined }, async () => {
    let called = false;
    const result = await search.runSearch({ query: "问题", sources: ["web"] }, async () => { called = true; throw new Error("不应联网"); });
    assert.equal(called, false);
    assert.deepEqual(result.results, []);
    assert.equal(result.mode, "unconfigured");
    assert.equal(result.used, 0);
  });
});

test("SearchPro使用官方鉴权与Site，解析JSON字符串Pages并过滤伪域名", async () => {
  await withEnv({ YUANBAO_API_KEY: "test-only-yuanbao", YUANBAO_SEARCH_ENDPOINT: undefined }, async () => {
    let calls = 0;
    const result = await search.runSearch({ query: "长城", sources: ["bilibili"], stepId: "step-1", limit: 5 }, async (url, options) => {
      calls++;
      assert.equal(url, "https://api.wsa.cloud.tencent.com/SearchPro");
      assert.equal(options.headers.Authorization, "Bearer test-only-yuanbao");
      assert.deepEqual(JSON.parse(options.body), { Query: "长城", Site: "bilibili.com" });
      const valid = JSON.stringify({ title: "一条结果", url: "https://www.bilibili.com/video/BVtest", passage: "<strong>原始</strong>摘要", date: "2026-10-24" });
      return Response.json({ Response: { RequestId: "request-test", Pages: [valid, valid, "invalid json", JSON.stringify({ title: "伪域名", url: "https://bilibili.com.evil.example/1", passage: "错误" }), JSON.stringify({ title: "不安全", url: "javascript:alert(1)", passage: "错误" })] } });
    });
    assert.equal(calls, 1);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].snippet, "原始摘要");
    assert.equal(result.results[0].relation, "context");
    assert.equal(result.results[0].stepId, "step-1");
    assert.equal(result.requestId, "request-test");
    assert.equal(result.used, 1);
  });
});

test("SearchPro HTTP200中的服务错误仍会正确失败", async () => {
  await withEnv({ YUANBAO_API_KEY: "test-only-yuanbao" }, async () => {
    await assert.rejects(search.runSearch({ query: "问题", sources: ["web"] }, async () => Response.json({ Response: { Error: { Code: "UnauthorizedOperation", Message: "secret" } } })), { code: "SEARCH_PROVIDER_ERROR" });
  });
});

test("微信验签拒绝错误签名和过期重放，菜单不调用模型", () => {
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const token = "test-wechat-token";
  const nonce = "nonce-test";
  const signature = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  const url = new URL(`https://example.com/api/wechat?timestamp=${timestamp}&nonce=${nonce}&signature=${signature}`);
  assert.equal(wechat.verifyWechatSignature(url, token, now), true);
  assert.equal(wechat.verifyWechatSignature(url, "wrong", now), false);
  assert.equal(wechat.verifyWechatSignature(url, token, now + 700_000), false);
  const reply = wechat.wechatMenuReply("<xml><ToUserName><![CDATA[to]]></ToUserName><FromUserName><![CDATA[from]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[帮助]]></Content></xml>");
  assert.match(reply, /异步任务队列/);
  assert.match(reply, /<ToUserName><!\[CDATA\[from\]\]>/);
  assert.throws(() => wechat.wechatMenuReply("<!DOCTYPE xml><xml></xml>"), { code: "INVALID_WECHAT_XML" });
});

test("机器人在未接入密钥时可建立调查，但不会把未检索的步骤标成完成", async () => {
  await withEnv({ TOKLENS_API_KEY: undefined, TOKLENS_MODEL: undefined, YUANBAO_API_KEY: undefined, YUANBAO_SEARCH_API_KEY: undefined, TENCENTCLOUD_WSA_APIKEY: undefined }, async () => {
    const created = await chat.chatCommand({ message: "新建 月球上能肉眼看见长城吗" });
    assert.equal(created.session.steps.length, 4);
    assert.equal(created.mode, "demo");
    const scoped = await chat.chatCommand({ message: "来源 1,4", session: created.session });
    assert.deepEqual(scoped.session.sources, ["official", "bilibili"]);
    const next = await chat.chatCommand({ message: "下一步", session: scoped.session });
    assert.equal(next.mode, "unconfigured");
    assert.equal(next.session.cursor, 0);
    assert.deepEqual(next.session.evidence, []);
    const report = await chat.chatCommand({ message: "报告", session: next.session });
    assert.match(report.reply, /暂无线索，无法判断/);
  });
});
