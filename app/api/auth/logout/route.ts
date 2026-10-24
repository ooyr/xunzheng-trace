import { logout } from "../../../../lib/server/account";
import { errorResponse } from "../../../../lib/server/http";
export async function POST(request: Request) { try { return await logout(request); } catch (error) { return errorResponse(error); } }
