import { assertSameOrigin, requireUser } from "../../../lib/server/account";
import { runCheck, validateCheck } from "../../../lib/server/check";
import { errorResponse, jsonResponse, readJson } from "../../../lib/server/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = validateCheck(await readJson(request, 7_100_000));
    await requireUser(request);
    return jsonResponse(await runCheck(input));
  } catch (error) { return errorResponse(error); }
}
