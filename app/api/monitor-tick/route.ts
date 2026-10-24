import { authorizeMonitorTick, monitorTick } from "../../../lib/server/monitors";
import { errorResponse, jsonResponse } from "../../../lib/server/http";
export async function POST(request: Request) { try { authorizeMonitorTick(request); return jsonResponse(await monitorTick()); } catch (error) { return errorResponse(error); } }
