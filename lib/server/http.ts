export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED", public providerCode?: string) { super(message); }
}

export async function readTextBody(request: Pick<Request, "headers" | "body">, maxBytes = 32_000): Promise<string> {
  const announced = Number(request.headers.get("content-length") || 0);
  if (announced > maxBytes) throw new ApiError(413, "提交内容过大。", "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "缺少请求内容。", "INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, "提交内容过大。", "BODY_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ApiError(400, "请使用有效的 UTF-8 编码。", "INVALID_ENCODING"); }
}

export async function readJson(request: Request, maxBytes = 32_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "请使用 JSON 格式提交。", "INVALID_CONTENT_TYPE");
  const text = await readTextBody(request, maxBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new ApiError(400, "JSON 内容不正确。", "INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "请求内容应为一个对象。", "INVALID_BODY");
  return parsed as Record<string, unknown>;
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return jsonResponse({ error: error.message, code: error.code, ...(error.providerCode ? { providerCode: error.providerCode } : {}) }, error.status);
  return jsonResponse({ error: "服务暂时不可用，请稍后重试。", code: "INTERNAL_ERROR" }, 500);
}

export function textField(value: unknown, name: string, max: number, required = false): string {
  if (value !== undefined && typeof value !== "string") throw new ApiError(400, `${name}必须是文字。`, "INVALID_INPUT");
  const result = (value as string | undefined)?.trim() || "";
  if (result.length > max) throw new ApiError(400, `${name}最多 ${max} 个字符。`, "INVALID_INPUT");
  if (required && !result) throw new ApiError(400, `请填写${name}。`, "INVALID_INPUT");
  return result;
}

export function publicHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port && !["80", "443"].includes(url.port)) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return url.toString();
  } catch { return null; }
}

export function envValue(name: string): string { return process.env[name]?.trim() || ""; }

export function upstreamEndpoint(value: string, fallback: string): string {
  const selected = value || fallback;
  try {
    const url = new URL(selected);
    if (url.protocol !== "https:" || url.username || url.password || !publicHttpUrl(selected)) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch { throw new ApiError(503, "服务端 API 地址配置不正确，请检查 HTTPS 地址。", "INVALID_PROVIDER_CONFIG"); }
}

export async function providerJson(response: Response, provider: string): Promise<Record<string, any>> {
  if (!response.ok) {
    const status = response.status;
    const message = status === 401 || status === 403 ? `${provider}鉴权失败，请检查服务端密钥与模型权限。` : status === 429 ? `${provider}请求过于频繁或额度不足，请稍后重试并检查额度。` : `${provider}暂时不可用（HTTP ${status}）。`;
    throw new ApiError(status === 429 ? 429 : 502, message, "UPSTREAM_ERROR");
  }
  // 不向客户端转发上游原始错误，防止密钥或内部信息被带回。
  let value: unknown;
  try { value = JSON.parse(await readTextBody(response, 2_000_000)); } catch { throw new ApiError(502, `${provider}返回了无法解析或过大的数据。`, "INVALID_UPSTREAM_RESPONSE"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, `${provider}返回结构不正确。`, "INVALID_UPSTREAM_RESPONSE");
  return value as Record<string, any>;
}
