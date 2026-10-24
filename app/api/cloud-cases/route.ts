import { assertSameOrigin, database, requireUser } from "../../../lib/server/account";
import { parseBackup } from "../../../lib/validation";
import { ApiError, errorResponse, jsonResponse, readJson } from "../../../lib/server/http";
export async function GET(request: Request) {
  try { const user = await requireUser(request); const row = await (await database()).prepare("SELECT payload,updated_at FROM trace_cloud_cases WHERE user_id=?").bind(user.id).first<{ payload: string; updated_at: string }>(); return jsonResponse({ cases: row ? parseBackup(JSON.parse(row.payload)) : [], updatedAt: row?.updated_at || null }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try { assertSameOrigin(request); const user = await requireUser(request); const value = await readJson(request, 5 * 1024 * 1024); let cases; try { cases = parseBackup(value.cases); } catch { throw new ApiError(400, "调查档案未通过格式校验，请先检查本机备份。", "INVALID_BACKUP"); } if (cases.length > 50) throw new ApiError(400, "云端最多保存 50 份调查档案。", "CLOUD_CASE_LIMIT"); const updatedAt = new Date().toISOString(); await (await database()).prepare("INSERT INTO trace_cloud_cases (user_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(user.id, JSON.stringify(cases), updatedAt).run(); return jsonResponse({ saved: cases.length, updatedAt }); }
  catch (error) { return errorResponse(error); }
}
