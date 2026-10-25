import type { BranchAnswer, BranchAnswerDraft, Evidence, Investigation } from "./types";

export const ANSWER_VERDICTS = ["supported", "contradicted", "mixed", "insufficient"] as const;
export const verdictLabel = (value: BranchAnswer["verdict"]) => ({ supported: "资料支持", contradicted: "资料反驳", mixed: "证据有分歧", insufficient: "证据不足" })[value];

// 只沿目标分支的父节点回溯，旁支和预置示例不能变成当前结论的依据。
export function answerEvidence(item: Investigation, branchId = item.activeBranch): Evidence[] {
  const branch = item.branches.find(entry => entry.id === branchId);
  if (!branch) return [];
  const commits = new Map(item.commits.map(entry => [entry.id, entry]));
  const seen = new Set<string>(); const cited = new Set<string>(); const queue = [branch.head];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id); const commit = commits.get(id);
    if (commit) { commit.evidenceIds.forEach(value => cited.add(value)); queue.push(...commit.parents); }
  }
  return item.evidence.filter(entry => cited.has(entry.id) && entry.kind !== "demo");
}

// 指纹用于发现资料或问题变化，不作为防篡改签名或身份凭证。
export function evidenceFingerprint(item: Investigation, branchId = item.activeBranch): string {
  const branch = item.branches.find(entry => entry.id === branchId);
  const visible = answerEvidence(item, branchId).map(entry => [entry.id, entry.title, entry.url, entry.snippet, entry.source, entry.publishedAt || "", entry.relation, entry.kind]);
  const commits = new Map(item.commits.map(entry => [entry.id, entry])); const reached = new Set<string>(); const queue = branch ? [branch.head] : [];
  while (queue.length) { const id = queue.pop()!; if (reached.has(id)) continue; reached.add(id); const entry = commits.get(id); if (entry) queue.push(...entry.parents); }
  const history = item.commits.filter(entry => reached.has(entry.id)).map(entry => [entry.id, entry.parents, entry.type, entry.stepId || "", entry.type === "search" ? entry.description : "", entry.evidenceIds]);
  const source = JSON.stringify([item.title, item.input, item.inputUrl || "", branchId, branch?.head || "", item.steps.map(step => [step.id, step.title, step.description, step.query, [...step.sources].sort()]), history, visible]);
  let a = 0x811c9dc5; let b = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) { const code = source.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 2246822519); }
  return `a1:${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}:${source.length}`;
}

export function getBranchAnswer(item: Investigation, branchId = item.activeBranch): BranchAnswer | undefined {
  return item.answers?.find(entry => entry.branchId === branchId);
}
export function isAnswerCurrent(item: Investigation, answer: BranchAnswer): boolean {
  return item.branches.some(branch => branch.id === answer.branchId) && answer.fingerprint === evidenceFingerprint(item, answer.branchId);
}

export function saveBranchAnswer(item: Investigation, draft: BranchAnswerDraft, options: { origin?: BranchAnswer["origin"]; branchId?: string } = {}): Investigation {
  const branchId = options.branchId || item.activeBranch;
  if (!item.branches.some(entry => entry.id === branchId)) throw new Error("调查分支不存在。");
  const answer = draft.answer?.trim(); const reason = draft.reason?.trim();
  if (!answer || answer.length > 5000 || !reason || reason.length > 5000) throw new Error("请填写可能答案与依据，每项最多 5000 字。");
  if (!ANSWER_VERDICTS.includes(draft.verdict)) throw new Error("请选择有效的判断状态。");
  if (!Array.isArray(draft.limitations) || draft.limitations.length > 12 || draft.limitations.some(entry => typeof entry !== "string" || entry.length > 1000)) throw new Error("未解问题最多 12 项，每项最多 1000 字。");
  if (!Array.isArray(draft.evidenceIds) || draft.evidenceIds.length > 40 || draft.evidenceIds.some(entry => typeof entry !== "string")) throw new Error("结论引用最多 40 条资料。");
  const evidenceIds = [...new Set(draft.evidenceIds)]; const allowed = new Set(answerEvidence(item, branchId).map(entry => entry.id));
  if (evidenceIds.some(id => !allowed.has(id))) throw new Error("只能引用当前分支可追溯的真实资料，不能引用旁支或演示资料。");
  if (draft.verdict !== "insufficient" && !evidenceIds.length) throw new Error("支持、反驳或分歧判断需要至少一条可追溯来源；没有来源请选择证据不足。");
  const origin = options.origin || "manual";
  if (!["manual", "model"].includes(origin)) throw new Error("结论来源不正确。");
  const createdAt = new Date().toISOString();
  const value: BranchAnswer = { branchId, fingerprint: evidenceFingerprint(item, branchId), answer, verdict: draft.verdict, reason, limitations: draft.limitations.map(entry => entry.trim()).filter(Boolean), evidenceIds, origin, createdAt };
  return { ...item, answers: [...(item.answers || []).filter(entry => entry.branchId !== branchId), value], updatedAt: createdAt };
}
