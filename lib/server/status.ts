import type { ProviderStatus } from "../types";
import { envValue } from "./http";
import { yuanbaoKey } from "./search";

export function providerStatus(): ProviderStatus {
  return {
    model: { configured: Boolean(envValue("TOKLENS_API_KEY") && envValue("TOKLENS_MODEL")), provider: "TokLens", model: envValue("TOKLENS_MODEL") || "未配置" },
    search: { configured: Boolean(yuanbaoKey()), provider: "腾讯云元宝搜索 SearchPro" },
    wechat: { configured: Boolean(envValue("WECHAT_TOKEN")) },
  };
}
