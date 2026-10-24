import { assertSameOrigin, requireUser } from "../../../../lib/server/account";
import { updateMonitor } from "../../../../lib/server/monitors";
import { errorResponse, jsonResponse, readJson } from "../../../../lib/server/http";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const user = await requireUser(request); const { id } = await context.params; return jsonResponse(await updateMonitor(user.id, id, await readJson(request))); } catch (error) { return errorResponse(error); } }
