import { assertSameOrigin, requireUser } from "../../../lib/server/account";
import { generateBranchAnswer, validateAnswerRequest } from "../../../lib/server/answer";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireUser(request);
    const value = validateAnswerRequest(await readJson(request, 200_000));
    return jsonResponse({ answer: await generateBranchAnswer(value.investigation, value.branchId) });
  } catch (error) { return errorResponse(error); }
}
