import { assertSameOrigin, requireUser } from "../../../../../lib/server/account";
import { runOwnedMonitor } from "../../../../../lib/server/monitors";
import { errorResponse, jsonResponse } from "../../../../../lib/server/http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const user = await requireUser(request); const { id } = await context.params; return jsonResponse(await runOwnedMonitor(user.id, id)); } catch (error) { return errorResponse(error); } }
