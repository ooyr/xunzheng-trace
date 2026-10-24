import { runSearch, validateSearch } from "../../../lib/server/search";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";

export async function POST(request: Request) {
  try { return jsonResponse(await runSearch(validateSearch(await readJson(request)))); }
  catch (error) { return errorResponse(error); }
}
