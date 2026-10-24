import { accountStatusResponse } from "../../../../lib/server/account";
import { errorResponse } from "../../../../lib/server/http";
export async function GET(request: Request) { try { return await accountStatusResponse(request); } catch (error) { return errorResponse(error); } }
