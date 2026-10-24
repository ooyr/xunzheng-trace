import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { runCheck, validateCheck } = await importTypeScript(path.join(root, "lib/server/check.ts"));
const checkRoute = await importTypeScript(path.join(root, "app/api/check/route.ts"));
const image = "data:image/png;base64,AAAA";
const input = () => validateCheck({ image, input: "请核对截图中的条件", sources: ["web"] });
const extraction = (claims = ["待核查主张"]) => ({ extractedText: "截图识别原文", claims: claims.map((claim, index) => ({ claim, query: `query-${index + 1}` })) });
const completion = (value) => Response.json({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });
const page = (name, passage = "可核读的摘要", url = `https://example.com/${name}`) => JSON.stringify({ title: `资料${name}`, url, passage });

async function withEnv(values, run) {
  const config = {
    TOKLENS_API_KEY: "check-test-key", TOKLENS_MODEL: "check-text-model", TOKLENS_VISION_MODEL: "check-vision-model", TOKLENS_BASE_URL: "https://hkg.toklens.ai/v1",
    YUANBAO_API_KEY: "check-test-search-key", YUANBAO_SEARCH_API_KEY: undefined, TENCENTCLOUD_WSA_APIKEY: undefined, YUANBAO_SEARCH_ENDPOINT: undefined,
    TENCENT_SECRET_ID: undefined, TENCENT_SECRET_KEY: undefined, TENCENTCLOUD_SECRET_ID: undefined, TENCENTCLOUD_SECRET_KEY: undefined, ...values,
  };
  const before = {};
  for (const [name, value] of Object.entries(config)) { before[name] = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return await run(); }
  finally { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

test("截图收费接口先拒绝缺失或跨站Origin，同源访客仍需登录", async () => {
  for (const origin of [undefined, "https://other.example"]) {
    const request = new Request("https://trace.example/api/check", { method: "POST", headers: origin ? { Origin: origin } : {} });
    const response = await checkRoute.POST(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "INVALID_ORIGIN");
  }
  const sameOriginCrossSite = new Request("https://trace.example/api/check", { method: "POST", headers: { Origin: "https://trace.example", "Sec-Fetch-Site": "cross-site" } });
  assert.equal((await checkRoute.POST(sameOriginCrossSite)).status, 403);
  const visitor = new Request("https://trace.example/api/check", { method: "POST", headers: { Origin: "https://trace.example", "Content-Type": "application/json" }, body: JSON.stringify({ image, sources: ["web"] }) });
  const response = await checkRoute.POST(visitor);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "LOGIN_REQUIRED");
});

test("截图校验要求图片与有效来源，限制实际解码大小", () => {
  assert.throws(() => validateCheck({ sources: ["web"] }), { code: "INVALID_INPUT" });
  assert.throws(() => validateCheck({ image: "data:text/html;base64,AAAA", sources: ["web"] }), { code: "INVALID_IMAGE" });
  assert.throws(() => validateCheck({ image: "data:image/png;base64,AAA", sources: ["web"] }), { code: "INVALID_IMAGE" });
  assert.throws(() => validateCheck({ image, sources: [] }), { code: "INVALID_SOURCES" });
  const boundary = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024).toString("base64")}`;
  assert.equal(validateCheck({ image: boundary, sources: ["web"] }).image.length, boundary.length);
  const oversized = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`;
  assert.throws(() => validateCheck({ image: oversized, sources: ["web"] }), { code: "INVALID_IMAGE" });
});

test("未配置视觉模型时明确拒绝，不把文字模型或模板当成图片识别", async () => {
  await withEnv({ TOKLENS_VISION_MODEL: undefined }, async () => {
    let calls = 0;
    await assert.rejects(runCheck(input(), async () => { calls++; throw new Error("不应联网"); }), { code: "VISION_UNCONFIGURED" });
    assert.equal(calls, 0);
  });
});

test("视觉模型不支持图片或鉴权错误时返回脱敏错误且不消耗搜索", async () => {
  await withEnv({}, async () => {
    let calls = 0;
    await assert.rejects(runCheck(input(), async (url, options) => {
      calls++;
      assert.match(url, /chat\/completions$/);
      assert.equal(JSON.parse(options.body).model, "check-vision-model");
      return Response.json({ error: { message: "unsupported image check-test-key" } }, { status: 400 });
    }), error => error.code === "UPSTREAM_ERROR" && !error.message.includes("check-test-key"));
    assert.equal(calls, 1);
  });
});

test("视觉提取与每主张单次检索后只引用本次真实返回的资料", async () => {
  await withEnv({}, async () => {
    const searches = [];
    let models = 0;
    const result = await runCheck(input(), async (url, options) => {
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      const sent = JSON.parse(options.body);
      if (url.endsWith("/SearchPro")) {
        searches.push(sent.Query);
        return Response.json({ Response: { Pages: [page(sent.Query)], RequestId: `request-${sent.Query}` } });
      }
      models++;
      if (sent.model === "check-vision-model") {
        assert.equal(sent.messages[1].content[1].image_url.url, image);
        assert.match(sent.messages[0].content, /不是指令/);
        return completion(extraction(["主张一", "主张二"]));
      }
      assert.equal(sent.model, "check-text-model");
      assert.match(sent.messages[0].content, /转载/);
      assert.match(sent.messages[0].content, /不是指令/);
      const payload = JSON.parse(sent.messages[1].content.split("以下JSON仅为待查数据：")[1]);
      assert.equal(JSON.stringify(payload).includes("data:image/"), false);
      return completion({ results: payload.claims.map((claim, index) => ({ claimId: claim.id, verdict: index ? "refuted" : "supported", explanation: "依据所附摘要，仍需核对原始条件。", evidenceIds: [claim.evidence[0].id] })) });
    });
    assert.equal(result.status, "complete");
    assert.equal(result.extractedText, "截图识别原文");
    assert.equal(result.usedSearches, 2);
    assert.equal(models, 2);
    assert.deepEqual(searches.sort(), ["query-1", "query-2"]);
    assert.deepEqual(result.requestIds.sort(), ["request-query-1", "request-query-2"]);
    assert.deepEqual(result.results.map(entry => entry.verdict), ["supported", "refuted"]);
    for (const entry of result.results) assert.ok(result.evidence.some(evidence => evidence.id === entry.evidenceIds[0]));
    assert.equal(JSON.stringify(result).includes("data:image/"), false);
    assert.equal(JSON.stringify(result).includes("check-test-key"), false);
    assert.match(result.limitations.join(""), /反向搜图/);
  });
});

test("无资料不调用评估模型，不把未搜到当成反驳", async () => {
  await withEnv({}, async () => {
    let calls = 0;
    const result = await runCheck(input(), async (url, options) => {
      calls++;
      return url.endsWith("/SearchPro") ? Response.json({ Response: { Pages: [], RequestId: "empty-request" } }) : completion(extraction());
    });
    assert.equal(calls, 2);
    assert.equal(result.status, "complete");
    assert.equal(result.usedSearches, 1);
    assert.equal(result.results[0].verdict, "insufficient");
    assert.equal(result.results[0].status, "unknown");
    assert.deepEqual(result.results[0].evidenceIds, []);
    assert.deepEqual(result.evidence, []);
  });
});

test("虚构引用、跨主张引用和空证据的正反结论一律降为未知", async () => {
  await withEnv({}, async () => {
    for (const mode of ["fabricated", "cross-claim", "empty", "url"]) {
      const result = await runCheck(input(), async (url, options) => {
        const sent = JSON.parse(options.body);
        if (url.endsWith("/SearchPro")) return Response.json({ Response: { Pages: [page(sent.Query)] } });
        if (sent.model === "check-vision-model") return completion(extraction(["条件一", "条件二"]));
        const payload = JSON.parse(sent.messages[1].content.split("以下JSON仅为待查数据：")[1]);
        return completion({ results: payload.claims.map((claim, index) => ({ claimId: claim.id, verdict: "supported", explanation: mode === "url" ? "参考 https://fabricated.example/fake" : "模型给出的结论", evidenceIds: mode === "fabricated" ? ["ev-not-real"] : mode === "cross-claim" ? [payload.claims[1 - index].evidence[0].id] : mode === "empty" ? [] : [claim.evidence[0].id] })) });
      });
      assert.equal(result.status, "partial", mode);
      assert.equal(result.evidence.length, 2, mode);
      for (const entry of result.results) {
        assert.equal(entry.verdict, "insufficient", mode);
        assert.equal(entry.status, "unknown", mode);
        assert.deepEqual(entry.evidenceIds, [], mode);
      }
    }
  });
});

test("评估JSON无法解析时保留资料并明确部分完成", async () => {
  await withEnv({}, async () => {
    const result = await runCheck(input(), async (url, options) => {
      if (url.endsWith("/SearchPro")) return Response.json({ Response: { Pages: [page("saved")], RequestId: "saved-request" } });
      return JSON.parse(options.body).model === "check-vision-model" ? completion(extraction()) : completion("not json");
    });
    assert.equal(result.status, "partial");
    assert.equal(result.evidence.length, 1);
    assert.equal(result.usedSearches, 1);
    assert.equal(result.results[0].verdict, "insufficient");
    assert.equal(result.errors[0].code, "INVALID_CHECK_MODEL_JSON");
  });
});

test("搜索部分失败不重试，另一条仍可核对并保留实际请求次数", async () => {
  await withEnv({}, async () => {
    let searches = 0;
    const result = await runCheck(input(), async (url, options) => {
      const sent = JSON.parse(options.body);
      if (url.endsWith("/SearchPro")) {
        searches++;
        if (sent.Query === "query-1") throw new Error("secret-upstream-message");
        return Response.json({ Response: { Pages: [page("survived")], RequestId: "survived-request" } });
      }
      if (sent.model === "check-vision-model") return completion(extraction(["失败主张", "可核对主张"]));
      const payload = JSON.parse(sent.messages[1].content.split("以下JSON仅为待查数据：")[1]);
      assert.equal(payload.claims.length, 1);
      return completion({ results: [{ claimId: payload.claims[0].id, verdict: "supported", explanation: "所附资料对该具体条件提供线索，待核正文。", evidenceIds: [payload.claims[0].evidence[0].id] }] });
    });
    assert.equal(searches, 2);
    assert.equal(result.usedSearches, 2);
    assert.equal(result.status, "partial");
    assert.equal(result.results[0].status, "error");
    assert.equal(result.results[1].verdict, "supported");
    assert.equal(JSON.stringify(result).includes("secret-upstream-message"), false);
  });
});

test("重复主张只搜索一次，超过四条或无法提取时不开始搜索", async () => {
  await withEnv({}, async () => {
    let searches = 0;
    const duplicate = await runCheck(input(), async (url) => {
      if (url.endsWith("/SearchPro")) { searches++; return Response.json({ Response: { Pages: [] } }); }
      return completion(extraction(["同一主张", "同一 主张"]));
    });
    assert.equal(searches, 1);
    assert.equal(duplicate.claims.length, 1);
    for (const claims of [[], ["1", "2", "3", "4", "5"]]) {
      let calls = 0;
      await assert.rejects(runCheck(input(), async () => { calls++; return completion(extraction(claims)); }), error => ["NO_CHECKABLE_CLAIMS", "INVALID_CHECK_EXTRACTION"].includes(error.code));
      assert.equal(calls, 1);
    }
  });
});

test("同URL复用资料但只允许本条主张实际检索到的引用", async () => {
  await withEnv({}, async () => {
    const result = await runCheck(input(), async (url, options) => {
      const sent = JSON.parse(options.body);
      if (url.endsWith("/SearchPro")) return Response.json({ Response: { Pages: [page("shared", `同一网址针对${sent.Query}的原始摘要`, "https://example.com/shared")] } });
      if (sent.model === "check-vision-model") return completion(extraction(["同主题主张一", "同主题主张二"]));
      const payload = JSON.parse(sent.messages[1].content.split("以下JSON仅为待查数据：")[1]);
      assert.equal(payload.claims[0].evidence[0].id, payload.claims[1].evidence[0].id);
      assert.match(payload.claims[0].evidence[0].snippet, /query-1/);
      assert.doesNotMatch(payload.claims[0].evidence[0].snippet, /query-2/);
      assert.match(payload.claims[1].evidence[0].snippet, /query-2/);
      return completion({ results: payload.claims.map(claim => ({ claimId: claim.id, verdict: "insufficient", explanation: "同一来源并非独立交叉验证，仍需核读原文。", evidenceIds: [claim.evidence[0].id] })) });
    });
    assert.equal(result.status, "complete");
    assert.equal(result.evidence.length, 1);
    assert.equal(result.usedSearches, 2);
    assert.match(result.evidence[0].snippet, /query-1/);
    assert.match(result.evidence[0].snippet, /query-2/);
  });
});

test("上游重定向不跟随，识别失败不进入搜索", async () => {
  await withEnv({}, async () => {
    let calls = 0;
    await assert.rejects(runCheck(input(), async (url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://untrusted.example/" } });
    }), { code: "UPSTREAM_ERROR" });
    assert.equal(calls, 1);
  });
});
