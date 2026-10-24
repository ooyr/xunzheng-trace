import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, envValue } from "./http";

export function verifyWechatSignature(url: URL, token: string, now = Date.now()): boolean {
  const signature = url.searchParams.get("signature") || "";
  const timestamp = url.searchParams.get("timestamp") || "";
  const nonce = url.searchParams.get("nonce") || "";
  if (!token || !/^[a-f0-9]{40}$/i.test(signature) || !/^\d{10}$/.test(timestamp) || !nonce || nonce.length > 128) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 600) return false;
  const expected = createHash("sha1").update([token, timestamp, nonce].sort().join(""), "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected));
}

export function requireWechatSignature(request: Request): URL {
  const token = envValue("WECHAT_TOKEN");
  if (!token) throw new ApiError(503, "微信回调尚未配置 WECHAT_TOKEN。", "WECHAT_UNCONFIGURED");
  const url = new URL(request.url);
  if (!verifyWechatSignature(url, token)) throw new ApiError(403, "微信回调签名无效或已过期。", "INVALID_WECHAT_SIGNATURE");
  if (url.searchParams.get("encrypt_type") === "aes") throw new ApiError(501, "当前预留接口仅支持明文验证；加密模式需补充 EncodingAESKey 与解密适配。", "WECHAT_ENCRYPTION_UNSUPPORTED");
  return url;
}

function xmlField(xml: string, field: string): string {
  const match = xml.match(new RegExp(`<${field}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${field}>`));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}
function cdata(value: string): string { return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`; }

export function wechatMenuReply(xml: string): string {
  if (xml.length > 20_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ApiError(400, "不支持此微信消息格式。", "INVALID_WECHAT_XML");
  const from = xmlField(xml, "FromUserName");
  const to = xmlField(xml, "ToUserName");
  const type = xmlField(xml, "MsgType");
  if (!from || !to || from.length > 200 || to.length > 200 || !type) throw new ApiError(400, "微信消息缺少必要字段。", "INVALID_WECHAT_XML");
  if (!["text", "event"].includes(type)) return "success";
  const content = "循证调查局已连接。\n\n当前回调提供连接验证与菜单；实际调查请在网页中使用「机器人体验」。\n\n正式微信搜索还需异步任务队列、持久会话与结果回传配置，当前不会在回调中调用模型或消耗搜索额度。";
  return `<xml><ToUserName>${cdata(from)}</ToUserName><FromUserName>${cdata(to)}</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content>${cdata(content)}</Content></xml>`;
}
