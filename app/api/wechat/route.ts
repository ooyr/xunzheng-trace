import { ApiError, errorResponse, readTextBody } from "../../../lib/server/http";
import { requireWechatSignature, wechatMenuReply } from "../../../lib/server/wechat";

export async function GET(request: Request) {
  try {
    const url = requireWechatSignature(request);
    const echo = url.searchParams.get("echostr") || "";
    if (!echo || echo.length > 512) throw new ApiError(400, "缺少有效的 echostr。", "INVALID_WECHAT_ECHO");
    return new Response(echo, { headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireWechatSignature(request);
    const body = await readTextBody(request, 20_000);
    const reply = wechatMenuReply(body);
    return new Response(reply, { headers: { "Content-Type": reply === "success" ? "text/plain; charset=UTF-8" : "application/xml; charset=UTF-8", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
