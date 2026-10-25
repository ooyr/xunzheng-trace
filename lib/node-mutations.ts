import type { Branch, Commit, Investigation } from "./types";

export interface NodeEdit { title: string; note: string; }
export interface NodeDeletionPreview {
  nodeId: string;
  title: string;
  childCount: number;
  branchCount: number;
  exclusiveEvidenceCount: number;
  canDelete: boolean;
  reason?: string;
}

// 节点重命名与个人备注不会改写检索词、来源、接口编号等原始记录。
export function editNode(item: Investigation, nodeId: string, patch: NodeEdit): Investigation {
  if (!item.commits.some(node => node.id === nodeId)) throw new Error("这个节点已不存在，请重新选择。");
  if (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 500) throw new Error("节点标题不能为空，且最多 500 个字符。");
  if (typeof patch.note !== "string" || patch.note.length > 5000) throw new Error("节点备注最多 5000 个字符。");
  return {
    ...item,
    updatedAt: mutationTime(item),
    commits: item.commits.map(node => {
      if (node.id !== nodeId) return node;
      const updated = { ...node, title: patch.title.trim() };
      if (patch.note.trim()) updated.note = patch.note.trim();
      else delete updated.note;
      return updated;
    }),
  };
}

function mutationTime(item: Investigation): string {
  // 兼容客户端时钟偏差和含未来时间的有效备份，避免编辑后日期倒退。
  return new Date(Math.max(Date.now(), Date.parse(item.createdAt) || 0, Date.parse(item.updatedAt) || 0)).toISOString();
}

function assertGraph(item: Investigation): void {
  if (!item.commits.length) throw new Error("调查至少需要保留一个原始节点。");
  const nodes = new Map(item.commits.map(node => [node.id, node]));
  if (nodes.size !== item.commits.length) throw new Error("节点标识重复，请先恢复有效备份。");
  const branches = new Set(item.branches.map(branch => branch.id));
  if (!branches.has(item.activeBranch) || item.branches.some(branch => !nodes.has(branch.head))) throw new Error("调查分支引用不完整，请先恢复有效备份。");
  const evidence = new Set(item.evidence.map(entry => entry.id));
  const steps = new Set(item.steps.map(step => step.id));
  const degrees = new Map<string, number>();
  const children = new Map<string, string[]>();
  const queue: string[] = [];
  for (const node of item.commits) {
    if (!branches.has(node.branch) || node.stepId !== undefined && !steps.has(node.stepId) || node.evidenceIds.some(id => !evidence.has(id))) throw new Error("节点引用不完整，请先恢复有效备份。");
    if (node.parents.length > 8 || new Set(node.parents).size !== node.parents.length || node.parents.some(id => !nodes.has(id))) throw new Error("节点父级引用不完整，请先恢复有效备份。");
    degrees.set(node.id, node.parents.length);
    if (!node.parents.length) queue.push(node.id);
    for (const parent of node.parents) children.set(parent, [...(children.get(parent) || []), node.id]);
  }
  for (let position = 0; position < queue.length; position += 1) {
    for (const child of children.get(queue[position]) || []) {
      const remaining = degrees.get(child)! - 1;
      degrees.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }
  if (queue.length !== item.commits.length) throw new Error("调查历史包含循环引用，请先恢复有效备份。");
}

function fallbackHead(target: Commit, branch: Branch, nodes: Map<string, Commit>): string {
  // 分支末端删除时优先回到该分支最近的祖先，未找到时回到首个父节点。
  const seen = new Set<string>();
  const queue = [...target.parents];
  for (let position = 0; position < queue.length; position += 1) {
    const id = queue[position];
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id)!;
    if (node.branch === branch.id) return id;
    queue.push(...node.parents);
  }
  return target.parents[0];
}

function affectedBranchCount(item: Investigation, nodeId: string): number {
  const nodes = new Map(item.commits.map(node => [node.id, node]));
  return item.branches.filter(branch => {
    const seen = new Set<string>();
    const queue = [branch.head];
    for (let position = 0; position < queue.length; position += 1) {
      const id = queue[position];
      if (id === nodeId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(nodes.get(id)?.parents || []));
    }
    return false;
  }).length;
}

function planDeletion(item: Investigation, nodeId: string): { preview: NodeDeletionPreview; commits?: Commit[]; branches?: Branch[] } {
  const target = item.commits.find(node => node.id === nodeId);
  const elsewhere = new Set(item.commits.filter(node => node.id !== nodeId).flatMap(node => node.evidenceIds));
  const preview: NodeDeletionPreview = {
    nodeId,
    title: target?.title || "",
    childCount: item.commits.filter(node => node.parents.includes(nodeId)).length,
    branchCount: affectedBranchCount(item, nodeId),
    exclusiveEvidenceCount: new Set(target?.evidenceIds.filter(id => !elsewhere.has(id))).size,
    canDelete: false,
  };
  if (!target) return { preview: { ...preview, reason: "这个节点已不存在，请重新选择。" } };
  if (target.type === "init" || !target.parents.length) return { preview: { ...preview, reason: "原始线索节点不能删除，可以编辑标题和备注。" } };
  try {
    assertGraph(item);
    const nodes = new Map(item.commits.map(node => [node.id, node]));
    const commits = item.commits.filter(node => node.id !== nodeId).map(node => {
      if (!node.parents.includes(nodeId)) return node;
      const parents = [...new Set(node.parents.flatMap(id => id === nodeId ? target.parents : [id]))];
      if (parents.length > 8) throw new Error("删除后某个节点将超过 8 个父节点，请先整理分支后再删除。");
      return { ...node, parents };
    });
    const branches = item.branches.map(branch => branch.head === nodeId ? { ...branch, head: fallbackHead(target, branch, nodes) } : branch);
    assertGraph({ ...item, commits, branches });
    return { preview: { ...preview, canDelete: true }, commits, branches };
  } catch (error) {
    return { preview: { ...preview, reason: error instanceof Error ? error.message : "节点关系发生变化，请重新选择。" } };
  }
}

export function previewNodeDeletion(item: Investigation, nodeId: string): NodeDeletionPreview {
  return planDeletion(item, nodeId).preview;
}

// 只移除选中的提交，子节点重新连接其父级；证据原件与其他分支对象不删除。
export function deleteNode(item: Investigation, nodeId: string): Investigation {
  const { preview, commits, branches } = planDeletion(item, nodeId);
  if (!preview.canDelete || !commits || !branches) throw new Error(preview.reason || "当前节点不能删除。");
  const target = item.commits.find(node => node.id === nodeId)!;
  const steps = target.type === "search" && target.stepId
    ? item.steps.map(step => step.id === target.stepId && !commits.some(node => node.type === "search" && node.stepId === step.id && node.description === step.query)
      ? { ...step, status: "pending" as const }
      : step)
    : item.steps;
  return { ...item, commits, branches, steps, updatedAt: mutationTime(item) };
}
