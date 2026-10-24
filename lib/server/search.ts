import type { Evidence, SearchRequest, SearchResponse, SourceId } from "../types";
import { ApiError, envValue, providerJson, publicHttpUrl, textField, upstreamEndpoint } from "./http";
import { allowedSource, cleanSnippet, parseSources } from "./sources";

export function yuanbaoKey(): string { return envValue("YUANBAO_API_KEY") || envValue("YUANBAO_SEARCH_API_KEY") || envValue("TENCENTCLOUD_WSA_APIKEY"); }

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
  if (!key) return { results: [], mode: "unconfigured", used: 0, notice: "元宝搜索尚未接入。请在服务端配置 YUANBAO_API_KEY；本次未发起检索，也未消耗搜索额度。" };
  const endpoint = upstreamEndpoint(envValue("YUANBAO_SEARCH_ENDPOINT"), "https://api.wsa.cloud.tencent.com/SearchPro");
  // 单平台检索使用官方 Site 参数；混合范围只发一次检索，再校验真实返回域名。
  const selected = [...new Set(request.sources)];
  const site = selected.length === 1 ? ({ xiaohongshu: "xiaohongshu.com", bilibili: "bilibili.com" } as Partial<Record<SourceId, string>>)[selected[0]] : undefined;
  const payload = { Query: request.query, ...(site ? { Site: site } : {}) };
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000), redirect: "error" });
  } catch { throw new ApiError(504, "元宝搜索连接失败或超时。未自动重试，以避免重复消耗额度。", "SEARCH_TIMEOUT"); }
  const body = await providerJson(response, "元宝搜索");
  const result = body.Response;
  if (!result || typeof result !== "object") throw new ApiError(502, "元宝搜索返回结构不正确。", "INVALID_SEARCH_RESPONSE");
  if (result.Error) {
    const code = typeof result.Error.Code === "string" ? result.Error.Code : "";
    const messages: Record<string, string> = { UnauthorizedOperation: "元宝搜索鉴权失败，请检查服务 API KEY。", RequestLimitExceeded: "元宝搜索超过频率限制，请稍后重试。", ResourceNotFound: "元宝搜索服务尚未开通，请检查腾讯云控制台。", ResourceUnavailable: "元宝搜索资源不可用，请检查额度及服务状态。", InvalidParameter: "元宝搜索参数被拒绝，请检查当前服务版本及检索词。" };
    throw new ApiError(code === "RequestLimitExceeded" ? 429 : 502, messages[code] || "元宝搜索返回了服务错误，请检查控制台。", "SEARCH_PROVIDER_ERROR");
  }
  if (!Array.isArray(result.Pages)) throw new ApiError(502, "元宝搜索未返回 Pages 结果列表。", "INVALID_SEARCH_RESPONSE");
  const results = normalizePages(result.Pages, request.sources, request.stepId, request.limit);
  const notice = results.length ? "已完成 1 次元宝检索，并按所选来源的真实域名筛选。摘要是检索线索，请打开原文核对；相关性分数不等于事实可信度。" : "本次已调用元宝搜索，但未获得符合所选来源范围的有效结果。可调整检索词或扩大来源；查不到不代表原说法为假。";
  return { results, mode: "live", used: 1, requestId: typeof result.RequestId === "string" ? result.RequestId.slice(0, 100) : undefined, notice };
}
