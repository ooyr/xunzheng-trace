import { chatCommand } from "../../../lib/server/chat";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";
import { assertSameOrigin, consumeGuestQuota } from "../../../lib/server/account";

export async function POST(request: Request) {
  try { assertSameOrigin(request); return jsonResponse(await chatCommand(await readJson(request, 260_000), { beforePlan: () => consumeGuestQuota(request, "plan"), beforeSearch: () => consumeGuestQuota(request, "search") })); }
  catch (error) { return errorResponse(error); }
}
