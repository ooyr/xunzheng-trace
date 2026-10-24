import { chatCommand } from "../../../lib/server/chat";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";

export async function POST(request: Request) {
  try { return jsonResponse(await chatCommand(await readJson(request, 260_000))); }
  catch (error) { return errorResponse(error); }
}
