import { providerStatus } from "../../../lib/server/status";
import { errorResponse, jsonResponse } from "../../../lib/server/http";
import { modelConnectivity } from "../../../lib/server/diagnostics";

export async function GET(request: Request) {
  try {
    const status = providerStatus();
    if (new URL(request.url).searchParams.get("probe") === "1") return jsonResponse({ ...status, diagnostics: { model: await modelConnectivity() } });
    return jsonResponse(status);
  } catch (error) { return errorResponse(error); }
}
