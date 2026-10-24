import { runSearch, validateSearch } from "../../../lib/server/search";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";
import { consumeGuestQuota } from "../../../lib/server/account";

export async function POST(request: Request) {
  try { const value = validateSearch(await readJson(request)); await consumeGuestQuota(request, "search"); return jsonResponse(await runSearch(value)); }
  catch (error) { return errorResponse(error); }
}
