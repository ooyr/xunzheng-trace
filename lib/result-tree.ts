import type { Commit, Evidence, Investigation, PlanStep } from "./types";

export type ResultTreeState = "pending" | "running" | "blocked" | "changed" | "found" | "empty" | "sample" | "recorded";
export interface ResultTreeSource { evidence: Evidence; commitId: string; }
export interface ResultTreeGroup {
  id: string;
  title: string;
  description: string;
  query?: string;
  step?: PlanStep;
  state: ResultTreeState;
  sources: ResultTreeSource[];
  latestCommitId?: string;
  searchCount: number;
  latestQuery?: string;
}
export interface ResultTreeModel {
  direction: string;
  isMain: boolean;
  groups: ResultTreeGroup[];
  sourceCount: number;
  liveSourceCount: number;
  sampleSourceCount: number;
  searchCount: number;
}

// 按当前分支末端回溯，资料与步骤的关联以实际提交引用为准。
export function buildResultTree(item: Investigation): ResultTreeModel {
  const branch = item.branches.find(entry => entry.id === item.activeBranch);
  const byId = new Map(item.commits.map(entry => [entry.id, entry]));
  const distances = new Map<string, number>();
  const pending = branch ? [branch.head] : [];
  if (branch) distances.set(branch.head, 0);
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index];
    for (const parent of byId.get(current)?.parents || []) {
      if (distances.has(parent)) continue;
      distances.set(parent, distances.get(current)! + 1);
      pending.push(parent);
    }
  }
  const order = new Map(item.commits.map((entry, index) => [entry.id, index]));
  // 距分支末端更近的节点优先；合并两侧距离相同时保留最近收录顺序。
  const commits = item.commits.filter(entry => distances.has(entry.id)).sort((a, b) => distances.get(a.id)! - distances.get(b.id)! || order.get(b.id)! - order.get(a.id)!);
  const evidenceById = new Map(item.evidence.map(entry => [entry.id, entry]));
  const allEvidenceIds = new Set(commits.flatMap(entry => entry.evidenceIds));
  const assignedEvidenceIds = new Set<string>();
  const makeSources = (records: Commit[]): ResultTreeSource[] => {
    const seen = new Set<string>();
    const result: ResultTreeSource[] = [];
    for (const commit of records) {
      for (const id of commit.evidenceIds) {
        const evidence = evidenceById.get(id);
        if (!evidence || seen.has(id)) continue;
        seen.add(id);
        result.push({ evidence, commitId: commit.id });
      }
    }
    return result;
  };
  const groups: ResultTreeGroup[] = item.steps.map(step => {
    const records = commits.filter(entry => entry.stepId === step.id);
    const sources = makeSources(records);
    for (const source of sources) assignedEvidenceIds.add(source.evidence.id);
    const searches = records.filter(entry => entry.type === "search");
    const latestSearch = searches.find(entry => entry.description.trim() === step.query.trim());
    // 预置查询的说明不一定存放原始查询词，不能据此推断用户修改过条件。
    const onlySampleSources = sources.length > 0 && sources.every(source => source.evidence.kind === "demo");
    const purelySample = onlySampleSources && !searches.some(entry => entry.searchMode === "live");
    let state: ResultTreeState = "pending";
    if (step.status === "running") state = "running";
    else if (step.status === "blocked") state = "blocked";
    else if (latestSearch?.searchMode === "live") state = latestSearch.evidenceIds.some(id => evidenceById.has(id)) ? "found" : "empty";
    else if (purelySample) state = "sample";
    else if (searches.length && !latestSearch) state = "changed";
    else if (onlySampleSources) state = "sample";
    else if (latestSearch) state = "recorded";
    return {
      id: step.id, title: step.title, description: step.description, query: step.query, step, state, sources,
      ...(records[0] ? { latestCommitId: records[0].id } : {}),
      searchCount: searches.filter(entry => entry.searchMode === "live").length,
      ...(searches[0] ? { latestQuery: searches[0].description } : {}),
    };
  });
  const stepIds = new Set(item.steps.map(step => step.id));
  const supplementalRecords = commits.filter(entry => !entry.stepId || !stepIds.has(entry.stepId));
  const supplementalSources = makeSources(supplementalRecords).filter(source => !assignedEvidenceIds.has(source.evidence.id));
  const supplementalSearches = supplementalRecords.filter(entry => entry.type === "search" && entry.searchMode === "live");
  if (supplementalSources.length || supplementalSearches.length) {
    const latest = supplementalSearches[0];
    groups.push({
      id: "unassigned:records", title: "补充查询与资料", description: "已收录、但未关联到上述子问题的来源与查询记录。", sources: supplementalSources,
      state: latest ? latest.evidenceIds.some(id => evidenceById.has(id)) ? "found" : "empty" : supplementalSources.every(source => source.evidence.kind === "demo") ? "sample" : "found",
      ...(latest || supplementalSources[0] ? { latestCommitId: latest?.id || supplementalSources[0].commitId } : {}),
      searchCount: supplementalSearches.length,
      ...(latest ? { latestQuery: latest.description } : {}),
    });
  }
  const visibleEvidence = item.evidence.filter(entry => allEvidenceIds.has(entry.id));
  return {
    direction: !branch ? "未选择调查方向" : branch.id === "main" ? "主线" : branch.name,
    isMain: branch?.id === "main", groups, sourceCount: visibleEvidence.length,
    liveSourceCount: visibleEvidence.filter(entry => entry.kind !== "demo").length,
    sampleSourceCount: visibleEvidence.filter(entry => entry.kind === "demo").length,
    searchCount: commits.filter(entry => entry.type === "search" && entry.searchMode === "live").length,
  };
}
