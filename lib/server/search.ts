import type { Evidence, SearchRequest, SearchResponse, SourceId } from "../types";
import { ApiError, envValue, publicHttpUrl, readTextBody, textField, upstreamEndpoint } from "./http";
import { allowedSource, cleanSnippet, parseSources } from "./sources";
import { tc3Headers, tencentWsaEndpoint } from "./tc3";

export function yuanbaoKey(): string { return envValue("YUANBAO_API_KEY") || envValue("YUANBAO_SEARCH_API_KEY") || envValue("TENCENTCLOUD_WSA_APIKEY"); }

export function tencentCredentials(): { secretId: string; secretKey: string } {
  return { secretId: envValue("TENCENT_SECRET_ID") || envValue("TENCENTCLOUD_SECRET_ID"), secretKey: envValue("TENCENT_SECRET_KEY") || envValue("TENCENTCLOUD_SECRET_KEY") };
}

export function searchAuthMode(): "bearer" | "tc3" | "unconfigured" {
  if (yuanbaoKey()) return "bearer";
  const { secretId, secretKey } = tencentCredentials();
  return secretId && secretKey ? "tc3" : "unconfigured";
}

// 只公开明确列出的服务错误码，绝不把任意上游文本或密钥带回客户端。
const SEARCH_PROVIDER_CODES: ReadonlySet<string> = new Set([
  "AuthFailure", "AuthFailure.InvalidAuthorization", "AuthFailure.InvalidSecretId", "AuthFailure.SecretIdNotFound", "AuthFailure.SignatureFailure", "AuthFailure.SignatureExpire", "AuthFailure.TokenFailure", "AuthFailure.UnauthorizedOperation",
  "UnauthorizedOperation", "ResourceNotFound", "ResourceUnavailable", "RequestLimitExceeded", "InvalidParameter", "InvalidParameterValue", "MissingParameter", "InvalidAction", "NoSuchVersion", "IpInBlacklist", "IpNotInWhitelist", "InternalError", "UnsupportedOperation",
]);

function searchProviderError(error: unknown): ApiError | undefined {
  if (!error) return undefined;
  const rawCode = typeof error === "object" ? (error as { Code?: unknown }).Code : undefined;
  const providerCode = typeof rawCode === "string" && SEARCH_PROVIDER_CODES.has(rawCode) ? rawCode : undefined;
  const messages: Record<string, string> = {
    UnauthorizedOperation: "元宝搜索权限不足，请检查服务授权、服务 API KEY 或云账户权限。",
    RequestLimitExceeded: "元宝搜索超过频率限制，请稍后重试。",
    ResourceNotFound: "元宝搜索服务尚未开通，请检查腾讯云控制台。",
    ResourceUnavailable: "元宝搜索资源不可用，请检查额度及服务状态。",
    InvalidParameter: "元宝搜索参数被拒绝，请检查当前服务版本及检索词。",
  };
  const message = providerCode?.startsWith("AuthFailure") ? "元宝搜索签名鉴权失败，请检查密钥对、授权与服务器时间。" : messages[providerCode || ""] || "元宝搜索返回了服务错误，请检查控制台。";
  return new ApiError(providerCode === "RequestLimitExceeded" ? 429 : 502, message, "SEARCH_PROVIDER_ERROR", providerCode);
}

function searchHttpError(status: number): ApiError {
  const message = status === 401 || status === 403 ? "元宝搜索鉴权失败，请检查服务端密钥与服务权限。" : status === 429 ? "元宝搜索请求过于频繁或额度不足，请稍后重试并检查额度。" : `元宝搜索暂时不可用（HTTP ${status}）。`;
  return new ApiError(status === 429 ? 429 : 502, message, "UPSTREAM_ERROR");
}

async function searchProviderJson(response: Response): Promise<Record<string, unknown>> {
  // 重定向不代表搜索结果；不读取正文或跟随 Location，避免泄露鉴权信息。
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw searchHttpError(response.status);
  }
  let body: unknown;
  try { body = JSON.parse(await readTextBody(response, 2_000_000)); }
  catch {
    if (!response.ok) throw searchHttpError(response.status);
    throw new ApiError(502, "元宝搜索返回了无法解析或过大的数据。", "INVALID_UPSTREAM_RESPONSE");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    if (!response.ok) throw searchHttpError(response.status);
    throw new ApiError(502, "元宝搜索返回结构不正确。", "INVALID_UPSTREAM_RESPONSE");
  }
  const result = (body as { Response?: unknown }).Response;
  if (result && typeof result === "object") {
    const error = searchProviderError((result as { Error?: unknown }).Error);
    if (error) throw error;
  }
  if (!response.ok) throw searchHttpError(response.status);
  return body as Record<string, unknown>;
}

export function validateSearch(value: Record<string, unknown>): SearchRequest {
  const limit = value.limit === undefined ? 8 : value.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiError(400, "返回条数应为 1 到 20 之间的整数。", "INVALID_LIMIT");
  return { query: textField(value.query, "检索词", 1000, true), sources: parseSources(value.sources), stepId: textField(value.stepId, "步骤编号", 100) || undefined, limit };
}

export function normalizePages(pages: unknown[], sources: SourceId[], stepId?: string, limit = 8): Evidence[] {
  const seen = new Set<string>();
  const results: Evidence[] = [];
  const retrievedAt = new Date().toISOString();
  for (const entry of pages.slice(0, 100)) {
    let page: Record<string, unknown>;
    try { page = typeof entry === "string" ? JSON.parse(entry) : entry as Record<string, unknown>; }
    catch { continue; }
    if (!page || typeof page !== "object" || typeof page.url !== "string") continue;
    const url = publicHttpUrl(page.url);
    if (!url) continue;
    const source = allowedSource(url, sources);
    if (!source || seen.has(url)) continue;
    const title = cleanSnippet(page.title, 300);
    const snippet = cleanSnippet(page.passage || page.content, 3000);
    if (!title || !snippet) continue;
    seen.add(url);
    results.push({ id: `ev-${crypto.randomUUID()}`, title, url, snippet, source, publishedAt: typeof page.date === "string" ? page.date.slice(0, 80) : undefined, retrievedAt, relation: "context", stepId, kind: "search" });
    if (results.length >= limit) break;
  }
  return results;
}

export async function runSearch(request: SearchRequest, fetcher: typeof fetch = fetch): Promise<SearchResponse & { requestId?: string }> {
  const key = yuanbaoKey();
  const { secretId, secretKey } = key ? { secretId: "", secretKey: "" } : tencentCredentials();
  if (!key && Boolean(secretId) !== Boolean(secretKey)) throw new ApiError(503, "腾讯云签名配置不完整，请同时配置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY（或对应的 TENCENTCLOUD 别名）。", "INVALID_PROVIDER_CONFIG");
  if (!key && !secretId) return { results: [], mode: "unconfigured", used: 0, notice: "元宝搜索尚未接入。请在服务端配置 YUANBAO_API_KEY，或 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 密钥对；本次未发起检索，也未消耗搜索额度。" };
  const endpoint = key ? upstreamEndpoint(envValue("YUANBAO_SEARCH_ENDPOINT"), "https://api.wsa.cloud.tencent.com/SearchPro") : tencentWsaEndpoint(envValue("TENCENT_WSA_ENDPOINT"));
  // 单平台检索使用官方 Site 参数；混合范围只发一次检索，再校验真实返回域名。
  const selected = [...new Set(request.sources)];
  const site = selected.length === 1 ? ({ xiaohongshu: "xiaohongshu.com", bilibili: "bilibili.com" } as Partial<Record<SourceId, string>>)[selected[0]] : undefined;
  const payload = { Query: request.query, ...(site ? { Site: site } : {}) };
  const serialized = JSON.stringify(payload);
  const headers = key ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json; charset=UTF-8" } : tc3Headers({ secretId, secretKey, host: new URL(endpoint).host, service: "wsa", action: "SearchPro", version: "2025-05-08", body: serialized });
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: "POST", headers, body: serialized, signal: AbortSignal.timeout(25_000), redirect: "manual" });
  } catch { throw new ApiError(504, "元宝搜索连接失败或超时。未自动重试，以避免重复消耗额度。", "SEARCH_TIMEOUT"); }
  const body = await searchProviderJson(response);
  if (!body.Response || typeof body.Response !== "object" || Array.isArray(body.Response)) throw new ApiError(502, "元宝搜索返回结构不正确。", "INVALID_SEARCH_RESPONSE");
  const result = body.Response as Record<string, unknown>;
  if (!Array.isArray(result.Pages)) throw new ApiError(502, "元宝搜索未返回 Pages 结果列表。", "INVALID_SEARCH_RESPONSE");
  const results = normalizePages(result.Pages, request.sources, request.stepId, request.limit);
  const notice = results.length ? "已完成 1 次元宝检索，并按所选来源的真实域名筛选。摘要是检索线索，请打开原文核对；相关性分数不等于事实可信度。" : "本次已调用元宝搜索，但未获得符合所选来源范围的有效结果。可调整检索词或扩大来源；查不到不代表原说法为假。";
  return { results, mode: "live", used: 1, requestId: typeof result.RequestId === "string" ? result.RequestId.slice(0, 100) : undefined, notice };
}
