import { envValue, upstreamEndpoint } from "./http";

// 只探测模型列表，不生成内容、不返回密钥或上游响应正文。
export async function modelConnectivity(fetcher: typeof fetch = fetch) {
  const key = envValue("TOKLENS_API_KEY");
  if (!key) return { configured: false, reachable: false, elapsedMs: 0 };
  const started = Date.now();
  try {
    const base = upstreamEndpoint(envValue("TOKLENS_BASE_URL"), "https://hkg.toklens.ai/v1");
    const response = await fetcher(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000), redirect: "manual" });
    await response.body?.cancel();
    return { configured: true, reachable: response.ok, httpStatus: response.status, elapsedMs: Date.now() - started };
  } catch (error) {
    const names = ["TimeoutError", "AbortError", "TypeError"];
    return { configured: true, reachable: false, elapsedMs: Date.now() - started, error: error instanceof Error && names.includes(error.name) ? error.name : "CONNECTION_FAILED" };
  }
}
