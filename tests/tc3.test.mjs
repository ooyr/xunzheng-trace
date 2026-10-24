import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tc3 = await importTypeScript(path.join(root, "lib/server/tc3.ts"));
const search = await importTypeScript(path.join(root, "lib/server/search.ts"));
const status = await importTypeScript(path.join(root, "lib/server/status.ts"));
const http = await importTypeScript(path.join(root, "lib/server/http.ts"));
const searchEnv = ["YUANBAO_API_KEY", "YUANBAO_SEARCH_API_KEY", "TENCENTCLOUD_WSA_APIKEY", "YUANBAO_SEARCH_ENDPOINT", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "TENCENT_WSA_ENDPOINT"];
const credentials = { TENCENT_SECRET_ID: "test-only-secret-id", TENCENT_SECRET_KEY: "test-only-secret-key" };
const request = { query: "长城", sources: ["bilibili"], limit: 5 };

async function withSearchEnv(values, run) {
  const before = {};
  for (const name of searchEnv) {
    before[name] = process.env[name];
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try { return await run(); }
  finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("TC3签名匹配腾讯云官方v3已知向量，使用UTC日期与二进制派生密钥", () => {
  // 固定向量来自 https://cloud.tencent.com/document/api/1806/121816 ，不依赖本实现重新计算期望值。
  const headers = tc3.tc3Headers({
    secretId: "AKID********************************", secretKey: "********************************",
    host: "cvm.tencentcloudapi.com", service: "cvm", action: "DescribeInstances", version: "2017-03-12", timestamp: 1551113065,
    body: '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}',
  });
  assert.equal(headers.Authorization, "TC3-HMAC-SHA256 Credential=AKID********************************/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f");
  assert.equal(headers["X-TC-Timestamp"], "1551113065");
  assert.equal(headers["Content-Type"], "application/json; charset=utf-8");
});

test("TC3搜索发送官方地址、公共头和同一UTF-8请求体，只调用一次并保留域名过滤", async t => {
  t.mock.method(Date, "now", () => 1551113065000);
  await withSearchEnv({ ...credentials, YUANBAO_SEARCH_ENDPOINT: "https://unused.example/SearchPro" }, async () => {
    let calls = 0;
    const result = await search.runSearch(request, async (url, options) => {
      calls++;
      assert.equal(url, "https://wsa.tencentcloudapi.com/");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, '{"Query":"长城","Site":"bilibili.com"}');
      // 额外固定向量由独立Python标准库hashlib/hmac计算，覆盖SearchPro接线及中文请求体。
      assert.deepEqual(options.headers, {
        Authorization: "TC3-HMAC-SHA256 Credential=test-only-secret-id/2019-02-25/wsa/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=bd1675acfa82d802a308240f00715ebf3f3092305ca264862de6adc4dc46f314",
        "Content-Type": "application/json; charset=utf-8", Host: "wsa.tencentcloudapi.com", "X-TC-Action": "SearchPro", "X-TC-Version": "2025-05-08", "X-TC-Timestamp": "1551113065",
      });
      assert.equal(new Headers(options.headers).has("X-TC-Region"), false);
      assert.equal(new Headers(options.headers).has("X-TC-Token"), false);
      return Response.json({ Response: { Pages: [
        JSON.stringify({ title: "站内结果", url: "https://www.bilibili.com/video/BVtest", passage: "线索" }),
        JSON.stringify({ title: "伪装域名", url: "https://bilibili.com.evil.example/1", passage: "伪装" }),
        JSON.stringify({ title: "其他范围", url: "https://example.com/1", passage: "未选来源" }),
      ] } });
    });
    assert.equal(calls, 1);
    assert.equal(result.used, 1);
    assert.equal(result.mode, "live");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].source, "bilibili");
    assert.equal(status.providerStatus().search.configured, true);
    assert.match(status.providerStatus().search.provider, /TC3-HMAC-SHA256/);
  });
});

test("TC3兼容TENCENTCLOUD密钥别名，混合来源不传Site", async () => {
  await withSearchEnv({ TENCENTCLOUD_SECRET_ID: "test-only-alias-id", TENCENTCLOUD_SECRET_KEY: "test-only-alias-key" }, async () => {
    await search.runSearch({ query: "问题", sources: ["bilibili", "xiaohongshu"] }, async (url, options) => {
      assert.equal(url, "https://wsa.tencentcloudapi.com/");
      assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=test-only-alias-id\//);
      assert.deepEqual(JSON.parse(options.body), { Query: "问题" });
      return Response.json({ Response: { Pages: [] } });
    });
  });
});

test("主密钥变量优先于TENCENTCLOUD别名", async () => {
  await withSearchEnv({ ...credentials, TENCENTCLOUD_SECRET_ID: "test-only-alias-id", TENCENTCLOUD_SECRET_KEY: "test-only-alias-key" }, async () => {
    assert.deepEqual(search.tencentCredentials(), { secretId: "test-only-secret-id", secretKey: "test-only-secret-key" });
  });
});

test("所有服务API KEY别名均优先Bearer，忽略半对TC3配置及其地址", async () => {
  for (const name of ["YUANBAO_API_KEY", "YUANBAO_SEARCH_API_KEY", "TENCENTCLOUD_WSA_APIKEY"]) {
    await withSearchEnv({ [name]: "test-only-bearer", TENCENT_SECRET_ID: "test-only-incomplete", TENCENT_WSA_ENDPOINT: "https://invalid.example/" }, async () => {
      await search.runSearch(request, async (url, options) => {
        assert.equal(url, "https://api.wsa.cloud.tencent.com/SearchPro");
        assert.equal(options.headers.Authorization, "Bearer test-only-bearer");
        assert.equal(new Headers(options.headers).has("X-TC-Action"), false);
        return Response.json({ Response: { Pages: [] } });
      });
      assert.equal(status.providerStatus().search.configured, true);
      assert.match(status.providerStatus().search.provider, /服务 API KEY/);
    });
  }
});

test("Bearer与完整TC3密钥并存时也优先服务API KEY，并保留自定义Bearer地址", async () => {
  await withSearchEnv({ ...credentials, YUANBAO_API_KEY: "test-only-bearer", YUANBAO_SEARCH_ENDPOINT: "https://bearer.example/SearchPro" }, async () => {
    await search.runSearch(request, async (url, options) => {
      assert.equal(url, "https://bearer.example/SearchPro");
      assert.equal(options.headers.Authorization, "Bearer test-only-bearer");
      return Response.json({ Response: { Pages: [] } });
    });
  });
});

test("仅配置密钥对一项时返回明确配置错误，不发请求", async () => {
  for (const name of ["TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY"]) {
    await withSearchEnv({ [name]: "test-only-incomplete" }, async () => {
      let calls = 0;
      await assert.rejects(search.runSearch(request, async () => { calls++; throw new Error("不应联网"); }), error => error.code === "INVALID_PROVIDER_CONFIG" && error.status === 503 && /同时配置/.test(error.message));
      assert.equal(calls, 0);
      assert.equal(status.providerStatus().search.configured, false);
    });
  }
});

test("未配置任意凭证时返回零消耗，配置无效地址也不发请求", async () => {
  await withSearchEnv({ TENCENT_WSA_ENDPOINT: "https://invalid.example/" }, async () => {
    let calls = 0;
    const result = await search.runSearch(request, async () => { calls++; throw new Error("不应联网"); });
    assert.equal(calls, 0);
    assert.equal(result.mode, "unconfigured");
    assert.equal(result.used, 0);
    assert.deepEqual(result.results, []);
    assert.equal(status.providerStatus().search.configured, false);
  });
});

test("TC3拒绝非官方地址、降级HTTP、用户信息、路径、查询、片段与非默认端口", async () => {
  for (const endpoint of ["https://evil.example/", "https://wsa.tencentcloudapi.com.evil.example/", "http://wsa.tencentcloudapi.com/", "https://user:pass@wsa.tencentcloudapi.com/", "https://wsa.tencentcloudapi.com/SearchPro", "https://wsa.tencentcloudapi.com/path/..", "https://wsa.tencentcloudapi.com/?q=1", "https://wsa.tencentcloudapi.com/?", "https://wsa.tencentcloudapi.com/#fragment", "https://wsa.tencentcloudapi.com:444/"]) {
    await withSearchEnv({ ...credentials, TENCENT_WSA_ENDPOINT: endpoint }, async () => {
      let calls = 0;
      await assert.rejects(search.runSearch(request, async () => { calls++; throw new Error("不应联网"); }), { code: "INVALID_PROVIDER_CONFIG" });
      assert.equal(calls, 0);
    });
  }
});

test("TC3显式官方根地址规范化并可发送", async () => {
  await withSearchEnv({ ...credentials, TENCENT_WSA_ENDPOINT: "https://wsa.tencentcloudapi.com" }, async () => {
    await search.runSearch(request, async url => {
      assert.equal(url, "https://wsa.tencentcloudapi.com/");
      return Response.json({ Response: { Pages: [] } });
    });
  });
});

test("签名、权限及未开通错误只公开白名单providerCode，HTTP错误也可定位", async () => {
  await withSearchEnv(credentials, async () => {
    for (const [providerCode, httpStatus] of [["AuthFailure.SignatureFailure", 401], ["AuthFailure.SignatureExpire", 200], ["AuthFailure.SecretIdNotFound", 403], ["UnauthorizedOperation", 200], ["ResourceNotFound", 400], ["RequestLimitExceeded", 429]]) {
      let calls = 0;
      await assert.rejects(search.runSearch(request, async () => {
        calls++;
        return Response.json({ Response: { Error: { Code: providerCode, Message: "secret test-only-secret-key test-only-secret-id" } } }, { status: httpStatus });
      }), asyncError => {
        assert.equal(asyncError.code, "SEARCH_PROVIDER_ERROR");
        assert.equal(asyncError.providerCode, providerCode);
        assert.equal(asyncError.status, providerCode === "RequestLimitExceeded" ? 429 : 502);
        assert.doesNotMatch(asyncError.message, /secret|test-only/);
        return true;
      });
      assert.equal(calls, 1);
    }
  });
});

test("未知上游Code和Message不得回传，已知Code通过errorResponse保留", async () => {
  await withSearchEnv(credentials, async () => {
    for (const providerCode of ["AuthFailure.SignatureFailure", "AuthFailure.secret-test-only-secret-key", "test-only-secret-id"]) {
      try {
        await search.runSearch(request, async () => Response.json({ Response: { Error: { Code: providerCode, Message: "test-only-secret-key" } } }));
        assert.fail("应抛出服务错误");
      } catch (error) {
        const response = http.errorResponse(error);
        const body = await response.json();
        assert.equal(body.code, "SEARCH_PROVIDER_ERROR");
        assert.equal(body.providerCode, providerCode === "AuthFailure.SignatureFailure" ? providerCode : undefined);
        assert.doesNotMatch(JSON.stringify(body), /test-only/);
      }
    }
  });
});

test("畸形Error字段即使附带Pages也不能冒充检索成功", async () => {
  await withSearchEnv(credentials, async () => {
    await assert.rejects(search.runSearch(request, async () => Response.json({ Response: { Error: "secret test-only-secret-key", Pages: [] } })), error => {
      assert.equal(error.code, "SEARCH_PROVIDER_ERROR");
      assert.equal(error.providerCode, undefined);
      assert.doesNotMatch(error.message, /test-only|secret/);
      return true;
    });
  });
});

test("上游非JSON错误及连接异常脱敏且不自动重试", async () => {
  await withSearchEnv(credentials, async () => {
    for (const failure of ["http", "timeout"]) {
      let calls = 0;
      await assert.rejects(search.runSearch(request, async () => {
        calls++;
        if (failure === "timeout") throw new Error("secret test-only-secret-key");
        return new Response("secret test-only-secret-key", { status: 403 });
      }), error => {
        assert.equal(error.code, failure === "timeout" ? "SEARCH_TIMEOUT" : "UPSTREAM_ERROR");
        assert.doesNotMatch(error.message, /test-only|secret/);
        return true;
      });
      assert.equal(calls, 1);
    }
  });
});
