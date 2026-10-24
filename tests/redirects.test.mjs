import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planner = await importTypeScript(path.join(root, "lib/server/planner.ts"));
const search = await importTypeScript(path.join(root, "lib/server/search.ts"));
const diagnostics = await importTypeScript(path.join(root, "lib/server/diagnostics.ts"));
const http = await importTypeScript(path.join(root, "lib/server/http.ts"));

const isolatedEnv = [
  "TOKLENS_API_KEY", "TOKLENS_BASE_URL", "TOKLENS_MODEL", "TOKLENS_VISION_MODEL",
  "YUANBAO_API_KEY", "YUANBAO_SEARCH_API_KEY", "TENCENTCLOUD_WSA_APIKEY", "YUANBAO_SEARCH_ENDPOINT",
  "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "TENCENT_WSA_ENDPOINT",
];
const modelEnv = { TOKLENS_API_KEY: "test-only-model-key", TOKLENS_MODEL: "test-only-model", TOKLENS_BASE_URL: "https://hkg.toklens.ai/v1" };
const redirectStatuses = [301, 302, 303, 307, 308];
const bodySecret = "redirect-body-secret";
const location = "https://redirect.invalid/redirect-location-secret?token=test-only-location-key";
const secretPattern = /redirect-body-secret|redirect-location-secret|redirect\.invalid|test-only-location-key|test-only-model-key|test-only-bearer-key|test-only-cloud-key|test-only-cloud-id/;

// 每次清除全部相关变量；所有请求均注入假 fetch，不加载本地凭证文件。
async function withEnv(values, run) {
  const before = new Map(isolatedEnv.map(name => [name, process.env[name]]));
  for (const name of isolatedEnv) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try { return await run(); }
  finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function redirectResponse(status, format) {
  const body = format === "json" ? JSON.stringify({ secret: bodySecret, location }) : `<html><body>${bodySecret}<a href="${location}">跳转</a></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": format === "json" ? "application/json" : "text/html", Location: location } });
}

async function assertSafeUpstreamError(run) {
  let caught;
  try { await run(); }
  catch (error) { caught = error; }
  assert.ok(caught, "重定向响应必须被拒绝");
  assert.equal(caught.code, "UPSTREAM_ERROR");
  assert.equal(caught.status, 502);
  assert.doesNotMatch(caught.message, secretPattern);
  const publicError = await http.errorResponse(caught).json();
  assert.equal(publicError.code, "UPSTREAM_ERROR");
  assert.equal(publicError.providerCode, undefined);
  assert.doesNotMatch(JSON.stringify(publicError), secretPattern);
}

test("模型计划对所有常见重定向只请求一次，使用manual且不泄露JSON或HTML正文及Location", async () => {
  await withEnv(modelEnv, async () => {
    for (const status of redirectStatuses) {
      for (const format of ["json", "html"]) {
        let calls = 0;
        await assertSafeUpstreamError(() => planner.createPlan({ input: "待核查说法", sources: ["official"] }, async (url, options) => {
          calls++;
          assert.equal(url, "https://hkg.toklens.ai/v1/chat/completions");
          assert.equal(options.redirect, "manual");
          return redirectResponse(status, format);
        }));
        assert.equal(calls, 1, `模型 ${status}/${format} 不得跟随或重试`);
      }
    }
  });
});

test("Bearer及TC3搜索对所有常见重定向只请求一次，使用manual且不泄露响应内容", async () => {
  const modes = [
    { env: { YUANBAO_API_KEY: "test-only-bearer-key" }, endpoint: "https://api.wsa.cloud.tencent.com/SearchPro", authorization: /^Bearer test-only-bearer-key$/ },
    { env: { TENCENT_SECRET_ID: "test-only-cloud-id", TENCENT_SECRET_KEY: "test-only-cloud-key" }, endpoint: "https://wsa.tencentcloudapi.com/", authorization: /^TC3-HMAC-SHA256 Credential=test-only-cloud-id\// },
  ];
  for (const mode of modes) {
    await withEnv(mode.env, async () => {
      for (const status of redirectStatuses) {
        for (const format of ["json", "html"]) {
          let calls = 0;
          let response;
          await assertSafeUpstreamError(() => search.runSearch({ query: "待核查说法", sources: ["web"] }, async (url, options) => {
            calls++;
            assert.equal(url, mode.endpoint);
            assert.equal(options.redirect, "manual");
            assert.match(new Headers(options.headers).get("Authorization"), mode.authorization);
            response = redirectResponse(status, format);
            return response;
          }));
          assert.equal(calls, 1, `搜索 ${status}/${format} 不得跟随或重试`);
          assert.equal(response.bodyUsed, true, "重定向正文应被取消释放");
        }
      }
    });
  }
});

test("模型连通诊断保留3xx状态并报告不可达，不跟随重定向或公开正文及Location", async () => {
  await withEnv(modelEnv, async () => {
    for (const status of redirectStatuses) {
      for (const format of ["json", "html"]) {
        let calls = 0;
        let response;
        const result = await diagnostics.modelConnectivity(async (url, options) => {
          calls++;
          assert.equal(url, "https://hkg.toklens.ai/v1/models");
          assert.equal(options.redirect, "manual");
          response = redirectResponse(status, format);
          return response;
        });
        assert.equal(calls, 1, `诊断 ${status}/${format} 不得跟随或重试`);
        assert.equal(result.configured, true);
        assert.equal(result.reachable, false);
        assert.equal(result.httpStatus, status);
        assert.equal(typeof result.elapsedMs, "number");
        assert.deepEqual(Object.keys(result).sort(), ["configured", "elapsedMs", "httpStatus", "reachable"]);
        assert.doesNotMatch(JSON.stringify(result), secretPattern);
        assert.equal(response.bodyUsed, true, "诊断应取消释放重定向正文");
      }
    }
  });
});

test("模型连通诊断缺少密钥时零网络调用", async () => {
  await withEnv({}, async () => {
    let calls = 0;
    const result = await diagnostics.modelConnectivity(async () => { calls++; throw new Error("不应联网"); });
    assert.equal(calls, 0);
    assert.deepEqual(result, { configured: false, reachable: false, elapsedMs: 0 });
  });
});

test("模型连通诊断成功后取消响应正文，避免保留上游响应流", async () => {
  await withEnv(modelEnv, async () => {
    let calls = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(bodySecret)); },
      cancel() { cancelled = true; },
    });
    const result = await diagnostics.modelConnectivity(async (url, options) => {
      calls++;
      assert.equal(url, "https://hkg.toklens.ai/v1/models");
      assert.equal(options.redirect, "manual");
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
    assert.equal(result.configured, true);
    assert.equal(result.reachable, true);
    assert.equal(result.httpStatus, 200);
    assert.doesNotMatch(JSON.stringify(result), secretPattern);
  });
});
