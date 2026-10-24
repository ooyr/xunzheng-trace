import { createPlan, validatePlan } from "../../../lib/server/planner";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";
import { consumeGuestQuota } from "../../../lib/server/account";

export async function POST(request: Request) {
  try { const value = validatePlan(await readJson(request, 7_100_000)); const user = await consumeGuestQuota(request, "plan", !!value.image); const plan = await createPlan(value); return jsonResponse(user ? plan : { ...plan, steps: plan.steps.slice(0, 2), notice: [plan.notice, "访客计划保留前两步，今日最多拆解 2 次、检索 3 次；登录后可使用完整计划。"].filter(Boolean).join(" ") }); }
  catch (error) { return errorResponse(error); }
}
