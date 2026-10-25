import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const http = await importTypeScript(path.join(root, "lib/server/http.ts"));
const diagnostics = await importTypeScript(path.join(root, "lib/server/diagnostics.ts"));
const secret = "test-only-provider-secret";

test("模型401与403使用不同固定提示，拒绝转发上游正文或误报应用账号故障", async () => {
  for (const [status, expected, rejected] of [
    [401, /当前服务端 API Key.*HTTP 401.*无需更换应用登录账号/, /账号名或密码不正确/],
    [403, /模型服务拒绝.*HTTP 403.*模型权限或服务限制/, /鉴权失败|密钥无效|API Key/],
    [429, /请求过于频繁或额度不足/, /鉴权失败/],
  ]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { message: secret, code: secret } }))); },
      cancel() { cancelled = true; },
    }), { status, headers: { "Content-Type": "application/json", "X-Provider-Secret": secret } });
    let caught;
    try { await http.providerJson(response, "TokLens"); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, "UPSTREAM_ERROR");
    assert.equal(caught.status, status === 429 ? 429 : 502);
    assert.match(caught.message, expected);
    assert.doesNotMatch(caught.message, rejected);
    assert.equal(cancelled, true);
    const publicResponse = http.errorResponse(caught);
    assert.equal(publicResponse.status, status === 429 ? 429 : 502);
    const body = await publicResponse.json();
    assert.equal(body.code, "UPSTREAM_ERROR");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
    assert.equal(body.providerCode, undefined);
  }
});

test("模型连通诊断仅返回固定401、403、429分类并释放含敏感信息的正文", async () => {
  const before = { TOKLENS_API_KEY: process.env.TOKLENS_API_KEY, TOKLENS_BASE_URL: process.env.TOKLENS_BASE_URL };
  process.env.TOKLENS_API_KEY = secret;
  process.env.TOKLENS_BASE_URL = "https://hkg.toklens.ai/v1";
  try {
    for (const [status, reason] of [[401, "KEY_REJECTED"], [403, "REQUEST_FORBIDDEN"], [429, "LIMITED"]]) {
      let calls = 0;
      let cancelled = false;
      const result = await diagnostics.modelConnectivity(async (url, options) => {
        calls++;
        assert.equal(url, "https://hkg.toklens.ai/v1/models");
        assert.equal(options.redirect, "manual");
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(secret)); },
          cancel() { cancelled = true; },
        }), { status });
      });
      assert.equal(calls, 1);
      assert.equal(cancelled, true);
      assert.equal(result.configured, true);
      assert.equal(result.reachable, false);
      assert.equal(result.httpStatus, status);
      assert.equal(result.reason, reason);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
      assert.deepEqual(Object.keys(result).sort(), ["configured", "elapsedMs", "httpStatus", "reachable", "reason"]);
    }
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
