import { authenticate } from "../../../../lib/server/account";
import { errorResponse, readJson } from "../../../../lib/server/http";
export async function POST(request: Request) { try { return await authenticate(request, await readJson(request), true); } catch (error) { return errorResponse(error); } }
