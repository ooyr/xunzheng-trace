import { createHash, createHmac } from "node:crypto";
import { ApiError } from "./http";

const CONTENT_TYPE = "application/json; charset=utf-8";
const SIGNED_HEADERS = "content-type;host;x-tc-action";

interface Tc3Request {
  secretId: string;
  secretKey: string;
  host: string;
  service: string;
  action: string;
  version: string;
  body: string;
  timestamp?: number;
}

// 云账户签名只能发送到元宝搜索官方根地址；独立于服务 API KEY 的地址配置。
export function tencentWsaEndpoint(value: string): string {
  const selected = value || "https://wsa.tencentcloudapi.com/";
  try {
    if (!/^https:\/\/wsa\.tencentcloudapi\.com\/?$/i.test(selected)) throw new Error();
    const url = new URL(selected);
    return url.toString();
  } catch {
    throw new ApiError(503, "TENCENT_WSA_ENDPOINT 必须是 https://wsa.tencentcloudapi.com/ 官方根地址。", "INVALID_PROVIDER_CONFIG");
  }
}

// 按腾讯云签名 v3 计算；body 必须直接使用发往上游的同一段 UTF-8 JSON。
export function tc3Headers(request: Tc3Request): Record<string, string> {
  const timestamp = request.timestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${request.host.toLowerCase()}\nx-tc-action:${request.action.toLowerCase()}\n`;
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${sha256(request.body)}`;
  const scope = `${date}/${request.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = createHmac("sha256", `TC3${request.secretKey}`).update(date, "utf8").digest();
  const secretService = createHmac("sha256", secretDate).update(request.service, "utf8").digest();
  const secretSigning = createHmac("sha256", secretService).update("tc3_request", "utf8").digest();
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${request.secretId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    "Content-Type": CONTENT_TYPE,
    Host: request.host,
    "X-TC-Action": request.action,
    "X-TC-Version": request.version,
    "X-TC-Timestamp": String(timestamp),
  };
}
