import { providerStatus } from "../../../lib/server/status";
import { errorResponse, jsonResponse } from "../../../lib/server/http";

export async function GET() {
  try { return jsonResponse(providerStatus()); } catch (error) { return errorResponse(error); }
}
