import type { ProviderStatus } from "../types";
import { envValue } from "./http";
import { searchAuthMode } from "./search";

export function providerStatus(): ProviderStatus {
  const authMode = searchAuthMode();
  return {
    model: { configured: Boolean(envValue("TOKLENS_API_KEY") && envValue("TOKLENS_MODEL")), provider: "TokLens", model: envValue("TOKLENS_MODEL") || "未配置" },
    search: { configured: authMode !== "unconfigured", provider: `腾讯云元宝搜索 SearchPro${authMode === "tc3" ? "（TC3-HMAC-SHA256）" : authMode === "bearer" ? "（服务 API KEY）" : "（服务 API KEY / TC3-HMAC-SHA256）"}` },
    wechat: { configured: Boolean(envValue("WECHAT_TOKEN")) },
  };
}
