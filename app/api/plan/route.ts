import { createPlan, validatePlan } from "../../../lib/server/planner";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";

export async function POST(request: Request) {
  try { return jsonResponse(await createPlan(validatePlan(await readJson(request, 7_100_000)))); }
  catch (error) { return errorResponse(error); }
}
