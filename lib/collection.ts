import type { Investigation, PlanStep, SearchRequest, SearchResponse, SourceId } from "./types";
import { appendCommit, branchCommits, safeUrl, uid } from "./investigation";

export interface CollectionProgress { current: number; total: number; stepId: string; title: string; added: number; totalAdded: number; phase?: "searching" | "saved"; }
export interface CollectionSummary { completed: number; total: number; added: number; reason: "completed" | "stopped" | "error" | "unconfigured" | "limit"; message?: string; }
export interface CollectionOptions {
  read: () => Investigation;
  save: (item: Investigation) => void;
  search: (request: SearchRequest) => Promise<SearchResponse>;
  branchId?: string;
  stepIds?: string[];
  maxRequests?: number;
  shouldStop?: () => boolean;
  onProgress?: (progress: CollectionProgress) => void;
  onCommit?: (commitId: string) => void;
}

// 按当前分支的可达历史判断已检索内容；改过查询词的步骤仍可继续查。
export function pendingSteps(item: Investigation, branchId = item.activeBranch): PlanStep[] {
  const searched = branchCommits(item, branchId).filter((commit) => commit.type === "search");
  return item.steps.filter((step) => step.status !== "running" && step.query.trim() && (step.status !== "done" || !searched.some((commit) => commit.stepId === step.id && commit.description === step.query)));
}

// 页面重载后已没有在途任务，恢复保存下来的执行中状态，让这些步骤可以继续。
export function recoverInterrupted(item: Investigation): Investigation {
  if (!item.steps.some((step) => step.status === "running")) return item;
  return { ...item, steps: item.steps.map((step) => step.status === "running" ? { ...step, status: "pending" } : step) };
}

export function applySearchResult(item: Investigation, stepId: string, response: SearchResponse, branchId: string, executed?: { query: string; sources: SourceId[] }): Investigation {
  const step = item.steps.find((entry) => entry.id === stepId);
  if (!step || !item.branches.some((branch) => branch.id === branchId)) throw new Error("调查步骤或分支已变化，请重新开始本轮检索。");
  if (response.mode === "unconfigured") return { ...item, updatedAt: new Date().toISOString(), steps: item.steps.map((entry) => entry.id === stepId ? { ...entry, status: "blocked" } : entry) };
  const currentSources = step.sources.length ? step.sources : item.sources;
  const actual = executed || { query: step.query, sources: currentSources };
  // 来源选择不依赖顺序；在途期间改过条件的步骤仍需检索新的查询。
  const sameSources = new Set(currentSources).size === new Set(actual.sources).size && currentSources.every((source) => actual.sources.includes(source));
  const status = step.query === actual.query && sameSources ? "done" : "pending";
  const evidence = [...item.evidence];
  const byUrl = new Map(evidence.map((entry) => [safeUrl(entry.url) || entry.url, entry]));
  const usedIds = new Set(evidence.map((entry) => entry.id));
  const references = new Set<string>();
  for (const entry of response.results) {
    const url = safeUrl(entry.url);
    if (!url) continue;
    let saved = byUrl.get(url);
    if (!saved) {
      const id = !entry.id || usedIds.has(entry.id) ? uid("e") : entry.id;
      saved = { ...entry, id, url, stepId, kind: "search" };
      evidence.push(saved); byUrl.set(url, saved); usedIds.add(id);
    } else if (saved.kind === "search") {
      // 搜索资料复查时更新共享快照，保留原编号、人工关系与首次关联步骤。
      // 不覆盖人工录入或预置示例；空摘要也不能抹掉已保存的有效资料。
      const refreshed = {
        ...saved,
        ...(typeof entry.title === "string" && entry.title.trim() ? { title: entry.title } : {}),
        ...(typeof entry.snippet === "string" && entry.snippet.trim() ? { snippet: entry.snippet } : {}),
        ...(typeof entry.source === "string" && entry.source.trim() ? { source: entry.source } : {}),
        ...(typeof entry.retrievedAt === "string" && entry.retrievedAt.trim() ? { retrievedAt: entry.retrievedAt } : {}),
        ...(typeof entry.publishedAt === "string" && entry.publishedAt.trim() ? { publishedAt: entry.publishedAt } : {}),
      };
      evidence[evidence.indexOf(saved)] = refreshed;
      saved = refreshed; byUrl.set(url, saved);
    }
    references.add(saved.id);
  }
  const added = evidence.length - item.evidence.length;
  const recorded = appendCommit({ ...item, activeBranch: branchId, evidence, mode: evidence.some((entry) => entry.kind === "demo") ? "demo" : "live", steps: item.steps.map((entry) => entry.id === stepId ? { ...entry, status } : entry) }, {
    title: added ? `自动收录 ${added} 条新线索` : references.size ? `复核 ${references.size} 条已收录资料` : "检索完成，未发现有效线索",
    description: actual.query, type: "search", stepId, evidenceIds: [...references], searchMode: "live", ...(response.requestId ? { requestId: response.requestId } : {}),
  });
  return { ...recorded, activeBranch: item.activeBranch };
}

// 串行执行并逐步落盘。暂停保留在途结果；错误停止，不自动重试。
export async function collectClues(options: CollectionOptions): Promise<CollectionSummary> {
  const initial = options.read();
  const branchId = options.branchId || initial.activeBranch;
  const requestedLimit = options.maxRequests ?? 6;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error("每轮检索次数必须是正整数。");
  const limit = Math.min(6, requestedLimit);
  const candidates = options.stepIds ? [...new Set(options.stepIds)].map((id) => initial.steps.find((step) => step.id === id)).filter((step): step is PlanStep => !!step && step.status !== "running" && !!step.query.trim()) : pendingSteps(initial, branchId);
  const total = candidates.length;
  let completed = 0; let added = 0; let requests = 0;
  const finish = (reason: CollectionSummary["reason"], message?: string): CollectionSummary => ({ completed, total, added, reason, ...(message ? { message } : {}) });
  if (!initial.branches.some((branch) => branch.id === branchId)) return finish("error", "调查分支不存在。");
  for (const planned of candidates) {
    if (options.shouldStop?.()) return finish("stopped");
    try {
      const current = options.read();
      const step = current.steps.find((entry) => entry.id === planned.id);
      if (current.id !== initial.id || !current.branches.some((branch) => branch.id === branchId) || !step || !step.query.trim()) return finish("error", "调查步骤或分支已变化，请检查计划后继续。");
      // 队列生成后可能已有其它操作完成某步；显式重查也不能接管仍在执行的步骤。
      if (step.status === "running" || (!options.stepIds && !pendingSteps(current, branchId).some((entry) => entry.id === step.id))) continue;
      if (requests >= limit) return finish("limit");
      const executed = { query: step.query, sources: [...(step.sources.length ? step.sources : current.sources)] };
      options.save({ ...current, steps: current.steps.map((entry) => entry.id === step.id ? { ...entry, status: "running" } : entry) });
      options.onProgress?.({ current: completed + 1, total, stepId: step.id, title: step.title, added: 0, totalAdded: added, phase: "searching" });
      requests += 1;
      const result = await options.search({ query: executed.query, sources: [...executed.sources], stepId: step.id, limit: 5 });
      const latest = options.read();
      if (latest.id !== initial.id) throw new Error("当前调查档案已变化，已停止后续检索。");
      const next = applySearchResult(latest, step.id, result, branchId, executed);
      options.save(next);
      if (result.mode === "unconfigured") return finish("unconfigured", result.notice || "搜索服务尚未配置，已保留调查计划。");
      const increment = next.evidence.length - latest.evidence.length;
      completed += 1; added += increment;
      options.onCommit?.(next.branches.find((branch) => branch.id === branchId)!.head);
      options.onProgress?.({ current: completed, total, stepId: step.id, title: step.title, added: increment, totalAdded: added, phase: "saved" });
    } catch (error) {
      // 仅更新原档案中仍在执行的步骤，不覆盖用户刚改过的计划或另一份档案。
      try {
        const latest = options.read();
        if (latest.id === initial.id) options.save({ ...latest, steps: latest.steps.map((entry) => entry.id === planned.id && entry.status === "running" ? { ...entry, status: "blocked" } : entry) });
      } catch { /* 读取或保存已不可用时，仍返回原始错误并停止队列。 */ }
      return finish("error", error instanceof Error ? error.message : "本次检索未完成，已收录线索会保留。");
    }
  }
  return finish(options.shouldStop?.() ? "stopped" : "completed");
}
