import { assertSameOrigin, requireUser } from "../../../lib/server/account";
import { createMonitor, listMonitors } from "../../../lib/server/monitors";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";
export async function GET(request: Request) { try { const user = await requireUser(request); return jsonResponse(await listMonitors(user.id)); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { assertSameOrigin(request); const user = await requireUser(request); return jsonResponse(await createMonitor(user.id, await readJson(request)), 201); } catch (error) { return errorResponse(error); } }
