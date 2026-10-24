import type { MonitorItem, MonitorJob, MonitorRun } from "../account-types";
import type { Evidence, SearchRequest, SearchResponse, SourceId } from "../types";
import { database, hashText, reserveLimit, beijingDay, constantTimeEqual } from "./account";
import { ApiError, envValue, textField, publicHttpUrl } from "./http";
import { parseSources } from "./sources";
import { runSearch } from "./search";

interface MonitorRow { id: string; user_id: string; title: string; query: string; sources: string; interval_hours: number; case_id: string | null; enabled: number; snapshot: string; has_baseline: number; created_at: string; last_run_at: string | null; next_run_at: string; unread_count: number; last_error: string | null; lease_until: string | null; }
interface RunRow { id: string; monitor_id: string; created_at: string; status: MonitorRun["status"]; new_count: number; changed_count: number; removed_count: number; request_id: string | null; summary: string; items: string; }
export interface SnapshotItem { title: string; url: string; fingerprint: string; }
export type Searcher = (request: SearchRequest) => Promise<SearchResponse>;
export function validateMonitor(value: Record<string, unknown>) {
  const intervalHours = value.intervalHours === undefined ? 6 : value.intervalHours;
  if (![1, 6, 24].includes(intervalHours as number)) throw new ApiError(400, "复查间隔请选择 1、6 或 24 小时。", "INVALID_INTERVAL");
  const caseId = textField(value.caseId, "调查标识", 128);
  return { title: textField(value.title, "盯梢名称", 120, true), query: textField(value.query, "检索词", 1000, true), sources: parseSources(value.sources), intervalHours: intervalHours as number, caseId: caseId || undefined };
}
export function validateMonitorPatch(value: Record<string, unknown>): { enabled?: boolean; read?: true } {
  if (value.enabled !== undefined && typeof value.enabled !== "boolean" || value.read !== undefined && value.read !== true || value.enabled === undefined && value.read === undefined) throw new ApiError(400, "请选择暂停、恢复或标记已读。", "INVALID_MONITOR_PATCH");
  return { ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}), ...(value.read === true ? { read: true as const } : {}) };
}
function readArray<T>(value: string): T[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
export async function snapshotOf(evidence: Evidence[]): Promise<SnapshotItem[]> {
  const unique = new Map<string, SnapshotItem>();
  for (const item of evidence.slice(0, 20)) {
    const parsed = publicHttpUrl(item.url); if (!parsed) continue;
    const normalizedUrl = new URL(parsed); normalizedUrl.hash = "";
    const url = normalizedUrl.href; if (unique.has(url)) continue;
    const title = item.title.slice(0, 300);
    const normalized = `${title.replace(/\s+/g, " ").trim()}\n${item.snippet.replace(/\s+/g, " ").trim()}`;
    unique.set(url, { title, url, fingerprint: await hashText(normalized) });
  }
  return [...unique.values()];
}
export function compareSnapshots(previous: SnapshotItem[], current: SnapshotItem[], hasBaseline: boolean): Pick<MonitorRun, "status" | "newCount" | "changedCount" | "removedCount" | "items" | "summary"> {
  const old = new Map(previous.map((item) => [item.url, item])); const present = new Set(current.map((item) => item.url));
  if (!hasBaseline) return { status: "baseline", newCount: 0, changedCount: 0, removedCount: 0, items: current.map((item) => ({ title: item.title, url: item.url, change: "unchanged" })), summary: `已建立 ${current.length} 条检索结果的基线，后续将比较链接与摘要变化。` };
  const items: MonitorItem[] = current.map((item) => ({ title: item.title, url: item.url, change: !old.has(item.url) ? "new" : old.get(item.url)!.fingerprint !== item.fingerprint ? "changed" : "unchanged" }));
  items.push(...previous.filter((item) => !present.has(item.url)).map((item): MonitorItem => ({ title: item.title, url: item.url, change: "removed" })));
  const newCount = items.filter((item) => item.change === "new").length; const changedCount = items.filter((item) => item.change === "changed").length; const removedCount = items.filter((item) => item.change === "removed").length;
  const changed = newCount + changedCount + removedCount > 0;
  return { status: changed ? "changed" : "unchanged", newCount, changedCount, removedCount, items, summary: changed ? `发现 ${newCount} 条新来源、${changedCount} 条标题或摘要变化，${removedCount} 条此前结果未在本轮出现。请打开原文核对。` : "本轮检索结果与基线一致，未发现链接或摘要变化。" };
}
function runView(row: RunRow): MonitorRun { return { id: row.id, createdAt: row.created_at, status: row.status, newCount: row.new_count, changedCount: row.changed_count, removedCount: row.removed_count, requestId: row.request_id || undefined, summary: row.summary, items: readArray<MonitorItem>(row.items) }; }
async function jobView(db: D1Database, row: MonitorRow): Promise<MonitorJob> {
  const history = await db.prepare("SELECT * FROM trace_monitor_runs WHERE monitor_id=? ORDER BY created_at DESC LIMIT 10").bind(row.id).all<RunRow>();
  return { id: row.id, title: row.title, query: row.query, sources: readArray<SourceId>(row.sources), intervalHours: row.interval_hours, caseId: row.case_id || undefined, enabled: !!row.enabled, createdAt: row.created_at, lastRunAt: row.last_run_at || undefined, nextRunAt: row.next_run_at, unreadCount: row.unread_count, lastError: row.last_error || undefined, runs: (history.results || []).map(runView) };
}
export async function ownedMonitor(db: D1Database, id: string, userId: string): Promise<MonitorRow> {
  const row = await db.prepare("SELECT * FROM trace_monitor_jobs WHERE id=? AND user_id=?").bind(id, userId).first<MonitorRow>();
  if (!row) throw new ApiError(404, "盯梢任务不存在。", "MONITOR_NOT_FOUND"); return row;
}
export async function listMonitors(userId: string, storage?: D1Database): Promise<{ monitors: MonitorJob[]; unreadCount: number }> {
  const db = storage || await database(); const rows = await db.prepare("SELECT * FROM trace_monitor_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(userId).all<MonitorRow>();
  const monitors = await Promise.all((rows.results || []).map((row) => jobView(db, row)));
  return { monitors, unreadCount: monitors.reduce((sum, job) => sum + job.unreadCount, 0) };
}
export async function createMonitor(userId: string, value: Record<string, unknown>, storage?: D1Database): Promise<{ monitor: MonitorJob }> {
  const data = validateMonitor(value); const db = storage || await database(); const id = `m-${crypto.randomUUID()}`; const now = new Date().toISOString();
  // 单条写入语句中检查数量，避免并发创建越过账号或全站配额。
  const inserted = await db.prepare("INSERT INTO trace_monitor_jobs (id,user_id,title,query,sources,interval_hours,case_id,created_at,next_run_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM trace_monitor_jobs WHERE user_id=? AND enabled=1)<3 AND (SELECT COUNT(*) FROM trace_monitor_jobs WHERE enabled=1)<50 AND (SELECT COUNT(*) FROM trace_monitor_jobs WHERE user_id=?)<20 RETURNING id").bind(id, userId, data.title, data.query, JSON.stringify(data.sources), data.intervalHours, data.caseId || null, now, now, userId, userId).first<{ id: string }>();
  if (!inserted) throw new ApiError(429, "活动盯梢数量达到上限：每账号 3 个，全站 50 个；每账号共可保留 20 个任务。", "MONITOR_LIMIT");
  return { monitor: await jobView(db, await ownedMonitor(db, id, userId)) };
}
export async function updateMonitor(userId: string, id: string, value: Record<string, unknown>, storage?: D1Database): Promise<{ monitor: MonitorJob }> {
  const data = validateMonitorPatch(value); const db = storage || await database(); await ownedMonitor(db, id, userId);
  if (data.enabled !== undefined) {
    const result = await db.prepare("UPDATE trace_monitor_jobs SET enabled=?,next_run_at=? WHERE id=? AND user_id=? AND (?=0 OR enabled=1 OR ((SELECT COUNT(*) FROM trace_monitor_jobs WHERE user_id=? AND enabled=1)<3 AND (SELECT COUNT(*) FROM trace_monitor_jobs WHERE enabled=1)<50)) RETURNING id").bind(data.enabled ? 1 : 0, new Date().toISOString(), id, userId, data.enabled ? 1 : 0, userId).first<{ id: string }>();
    if (!result) throw new ApiError(429, "活动盯梢数量达到上限，请先暂停其它任务。", "MONITOR_LIMIT");
  }
  if (data.read) await db.prepare("UPDATE trace_monitor_jobs SET unread_count=0 WHERE id=? AND user_id=?").bind(id, userId).run();
  return { monitor: await jobView(db, await ownedMonitor(db, id, userId)) };
}
export async function claimMonitorLease(db: D1Database, id: string, now: string, dueOnly: boolean, expectedLastRunAt: string | null = null): Promise<boolean> {
  const until = new Date(Date.parse(now) + 120000).toISOString();
  const cooldown = new Date(Date.parse(now) - 10000).toISOString();
  // 比较读取时的 last_run_at，避免第二个请求在前一次释放租约后继续使用过时快照。
  const result = await db.prepare(`UPDATE trace_monitor_jobs SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?) AND last_run_at IS ?${dueOnly ? " AND enabled=1 AND next_run_at<=?" : " AND (last_run_at IS NULL OR last_run_at<=?)"}`).bind(until, id, now, expectedLastRunAt, dueOnly ? now : cooldown).run();
  return result.meta.changes === 1;
}
export async function runMonitorRecord(db: D1Database, row: MonitorRow, dueOnly = false, searcher: Searcher = runSearch, now = new Date().toISOString()): Promise<MonitorRun | null> {
  if (!await claimMonitorLease(db, row.id, now, dueOnly, row.last_run_at)) return null;
  const id = `mr-${crypto.randomUUID()}`; const next = new Date(Date.parse(now) + row.interval_hours * 3600000).toISOString(); const lease = new Date(Date.parse(now) + 120000).toISOString();
  try {
    const budget = await reserveLimit(db, `monitor-daily:${beijingDay(Date.parse(now))}`, 60, new Date(Date.parse(now) + 86400000).toISOString());
    if (budget === null) throw new ApiError(429, "今日盯梢复查额度已用完，稍后自动继续。", "MONITOR_DAILY_LIMIT");
    const found = await searcher({ query: row.query, sources: readArray<SourceId>(row.sources), limit: 8 });
    if (found.mode !== "live") throw new ApiError(503, "元宝搜索尚未就绪，未建立结果基线。", "SEARCH_UNAVAILABLE");
    const snapshot = await snapshotOf(found.results); const comparison = compareSnapshots(readArray<SnapshotItem>(row.snapshot), snapshot, !!row.has_baseline);
    const result: MonitorRun = { id, createdAt: now, ...comparison, requestId: found.requestId };
    const saved = await db.batch([
      // lease_until 作为栅栏：过期任务不得覆盖后来持有者的快照或清空其租约。
      db.prepare("INSERT INTO trace_monitor_runs (id,monitor_id,created_at,status,new_count,changed_count,removed_count,request_id,summary,items) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM trace_monitor_jobs WHERE id=? AND lease_until=?)").bind(id, row.id, now, result.status, result.newCount, result.changedCount, result.removedCount, found.requestId || null, result.summary, JSON.stringify(result.items), row.id, lease),
      db.prepare("UPDATE trace_monitor_jobs SET snapshot=?,has_baseline=1,last_run_at=?,next_run_at=?,unread_count=unread_count+?,last_error=NULL,lease_until=NULL WHERE id=? AND lease_until=?").bind(JSON.stringify(snapshot), now, next, result.status === "changed" ? 1 : 0, row.id, lease),
      db.prepare("DELETE FROM trace_monitor_runs WHERE monitor_id=? AND id NOT IN (SELECT id FROM trace_monitor_runs WHERE monitor_id=? ORDER BY created_at DESC,id DESC LIMIT 100)").bind(row.id, row.id),
    ]);
    return saved[0].meta.changes === 1 && saved[1].meta.changes === 1 ? result : null;
  } catch (error) {
    const summary = error instanceof ApiError ? error.message : "复查暂未完成，请检查搜索服务后重试。";
    const result: MonitorRun = { id, createdAt: now, status: "error", newCount: 0, changedCount: 0, removedCount: 0, summary, items: [] };
    // 失败后至少间隔一小时再复查，不在同一次请求中自动重试。
    const retryAt = new Date(Date.parse(now) + Math.max(row.interval_hours, 1) * 3600000).toISOString();
    const saved = await db.batch([
      db.prepare("INSERT INTO trace_monitor_runs (id,monitor_id,created_at,status,new_count,changed_count,removed_count,summary,items) SELECT ?,?,?,?,0,0,0,?,? WHERE EXISTS (SELECT 1 FROM trace_monitor_jobs WHERE id=? AND lease_until=?)").bind(id, row.id, now, "error", summary, "[]", row.id, lease),
      db.prepare("UPDATE trace_monitor_jobs SET last_run_at=?,next_run_at=?,last_error=?,lease_until=NULL,unread_count=unread_count+1 WHERE id=? AND lease_until=?").bind(now, retryAt, summary, row.id, lease),
      db.prepare("DELETE FROM trace_monitor_runs WHERE monitor_id=? AND id NOT IN (SELECT id FROM trace_monitor_runs WHERE monitor_id=? ORDER BY created_at DESC,id DESC LIMIT 100)").bind(row.id, row.id),
    ]);
    return saved[0].meta.changes === 1 && saved[1].meta.changes === 1 ? result : null;
  }
}
export async function runOwnedMonitor(userId: string, id: string, storage?: D1Database, searcher?: Searcher): Promise<{ monitor: MonitorJob; run: MonitorRun }> {
  const db = storage || await database(); const row = await ownedMonitor(db, id, userId);
  if (row.last_run_at && Date.now() - Date.parse(row.last_run_at) < 10000) throw new ApiError(429, "请等待 10 秒后再手动复查。", "MONITOR_RUN_RATE_LIMIT");
  const run = await runMonitorRecord(db, row, false, searcher);
  if (!run) throw new ApiError(409, "这项盯梢正在复查，请稍后查看记录。", "MONITOR_RUNNING");
  return { monitor: await jobView(db, await ownedMonitor(db, id, userId)), run };
}
export function authorizeMonitorTick(request: Request): void {
  const key = envValue("MONITOR_RUNNER_TOKEN"); const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!key) throw new ApiError(503, "后台调度尚未配置。", "MONITOR_RUNNER_UNCONFIGURED");
  if (!constantTimeEqual(key, supplied)) throw new ApiError(401, "调度鉴权失败。", "UNAUTHORIZED_RUNNER");
}
export async function monitorTick(): Promise<{ checkedAt: string; processed: number; runs: { monitorId: string; run: MonitorRun }[] }> {
  const db = await database(); const now = new Date().toISOString();
  const due = await db.prepare("SELECT * FROM trace_monitor_jobs WHERE enabled=1 AND next_run_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_run_at ASC LIMIT 3").bind(now, now).all<MonitorRow>();
  const runs: { monitorId: string; run: MonitorRun }[] = [];
  for (const row of due.results || []) { const run = await runMonitorRecord(db, row, true); if (run) runs.push({ monitorId: row.id, run }); }
  return { checkedAt: now, processed: runs.length, runs };
}
