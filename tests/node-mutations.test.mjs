import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { editNode, deleteNode, previewNodeDeletion } = await importTypeScript(path.join(root, "lib/node-mutations.ts"));
const { parseBackup } = await importTypeScript(path.join(root, "lib/validation.ts"));
const { branchEvidence, branchCommits } = await importTypeScript(path.join(root, "lib/investigation.ts"));
const { pendingSteps } = await importTypeScript(path.join(root, "lib/collection.ts"));
const at = "2026-10-24T08:00:00.000Z";

function fixture() {
  const evidence = ["shared", "main", "side", "future"].map(name => ({ id: `e-${name}`, title: `资料-${name}`, url: `https://example.com/${name}`, snippet: `摘录-${name}`, source: "web", retrievedAt: at, relation: "context", kind: "search" }));
  const node = (id, parents, evidenceIds = [], branch = "main", type = "search") => ({ id, parents, evidenceIds, branch, type, title: `节点-${id}`, description: id === "query" ? "当前查询词" : `查询-${id}`, createdAt: at, ...(type === "search" ? { stepId: "step-1", searchMode: "live", requestId: `request-${id}` } : {}) });
  return {
    id: "case-test", title: "测试调查", input: "公开问题", createdAt: at, updatedAt: at,
    sources: ["web"], mode: "live", activeBranch: "main",
    steps: [{ id: "step-1", title: "核查来源", query: "当前查询词", description: "检索原始资料", sources: ["web"], status: "done" }],
    evidence,
    branches: [{ id: "main", name: "main", head: "future", color: "#258477" }, { id: "side", name: "旁支", head: "side", color: "#8899aa" }],
    commits: [node("root", [], [], "main", "init"), node("fork", ["root"], [], "main", "plan"), node("query", ["fork"], ["e-shared", "e-main"]), node("future", ["query"], ["e-future"]), node("side", ["fork"], ["e-shared", "e-side"], "side")],
  };
}

test("节点编辑只改标题和备注，不改检索事实，输入与其他节点保持原样", () => {
  const item = fixture(); const snapshot = structuredClone(item);
  const next = editNode(item, "query", { title: "  标出原始资料  ", note: "人工核读：需要确认发布日期。", description: "伪造查询" });
  const node = next.commits.find(node => node.id === "query");
  assert.equal(node.title, "标出原始资料"); assert.equal(node.note, "人工核读：需要确认发布日期。");
  assert.equal(node.description, "当前查询词"); assert.equal(node.requestId, "request-query");
  assert.deepEqual(node.evidenceIds, ["e-shared", "e-main"]); assert.deepEqual(node.parents, ["fork"]);
  assert.deepEqual(item, snapshot); assert.equal(next.commits[0], item.commits[0]);
  assert.deepEqual(parseBackup([next])[0], next);
  const cleared = editNode(next, "query", { title: node.title, note: "  " }); assert.equal(cleared.commits.find(node => node.id === "query").note, undefined);
  assert.throws(() => editNode(item, "query", { title: " ", note: "" }), /标题/);
  assert.throws(() => editNode(item, "query", { title: "x".repeat(501), note: "" }), /500/);
  assert.throws(() => editNode(item, "query", { title: "标题", note: "x".repeat(5001) }), /5000/);
  assert.throws(() => editNode(item, "missing", { title: "标题", note: "" }), /不存在/);
});

test("删除主线中间节点重接后续节点，保留共享资料原件与旁支", () => {
  const item = fixture(); const snapshot = structuredClone(item);
  const preview = previewNodeDeletion(item, "query");
  assert.deepEqual(preview, { nodeId: "query", title: "节点-query", childCount: 1, branchCount: 1, exclusiveEvidenceCount: 1, canDelete: true });
  const next = deleteNode(item, "query");
  assert.deepEqual(next.commits.find(node => node.id === "future").parents, ["fork"]);
  assert.equal(next.evidence, item.evidence);
  assert.deepEqual(branchEvidence(next).map(entry => entry.id), ["e-future"]);
  assert.deepEqual(branchEvidence({ ...next, activeBranch: "side" }).map(entry => entry.id), ["e-shared", "e-side"]);
  assert.equal(next.branches.find(branch => branch.id === "side"), item.branches.find(branch => branch.id === "side"));
  assert.deepEqual(pendingSteps(next).map(step => step.id), ["step-1"]);
  assert.equal(next.steps[0].status, "pending"); assert.deepEqual(item, snapshot);
  assert.deepEqual(parseBackup([next])[0], next);
});

test("删除旁支末端回退到分叉点，主线未来记录不受影响", () => {
  const item = fixture(); const next = deleteNode(item, "side");
  assert.equal(previewNodeDeletion(item, "side").branchCount, 1);
  assert.equal(next.branches.find(branch => branch.id === "side").head, "fork");
  assert.equal(next.branches.find(branch => branch.id === "main").head, "future");
  assert.deepEqual(branchCommits(next).map(node => node.id), ["root", "fork", "query", "future"]);
  assert.deepEqual(branchEvidence({ ...next, activeBranch: "side" }), []);
  assert.deepEqual(parseBackup([next])[0], next);
});

test("删除双父合并节点时分支末端优先回到自己的祖先", () => {
  const item = fixture();
  item.commits.push({ id: "merge", parents: ["side", "future"], evidenceIds: [], branch: "main", type: "merge", title: "汇入旁支", description: "保留两条历史", createdAt: at });
  item.branches[0].head = "merge";
  const next = deleteNode(item, "merge");
  assert.equal(next.branches[0].head, "future"); assert.equal(next.branches[1].head, "side");
  assert.deepEqual(parseBackup([next])[0], next);
});

test("删除已被合并的旁支节点会重新连接并去重，不残留父级引用", () => {
  const item = fixture();
  item.commits.push({ id: "merge", parents: ["future", "side", "fork"], evidenceIds: [], branch: "main", type: "merge", title: "合并", description: "", createdAt: at });
  item.branches[0].head = "merge";
  assert.equal(previewNodeDeletion(item, "side").branchCount, 2);
  const next = deleteNode(item, "side");
  assert.deepEqual(next.commits.find(node => node.id === "merge").parents, ["future", "fork"]);
  assert.equal(next.branches[1].head, "fork");
  assert.deepEqual(parseBackup([next])[0], next);
});

test("原始节点和无父节点受保护，失效图或超八个父级安全拒绝且不改原档", () => {
  const item = fixture(); const snapshot = structuredClone(item);
  assert.equal(previewNodeDeletion(item, "root").canDelete, false);
  assert.throws(() => deleteNode(item, "root"), /不能删除/);
  assert.equal(previewNodeDeletion(item, "missing").canDelete, false);
  const malformed = structuredClone(item); malformed.commits.find(node => node.id === "fork").parents = ["future"];
  assert.throws(() => deleteNode(malformed, "query"), /循环/);
  const orphan = structuredClone(item); orphan.commits.find(node => node.id === "query").parents = [];
  assert.throws(() => deleteNode(orphan, "query"), /原始/);
  const overflow = fixture();
  for (let i = 0; i < 9; i++) overflow.commits.push({ id: `extra-${i}`, parents: ["root"], evidenceIds: [], branch: "main", type: "plan", title: `记录${i}`, description: "", createdAt: at });
  overflow.commits.find(node => node.id === "query").parents = Array.from({ length: 8 }, (_, i) => `extra-${i}`);
  overflow.commits.find(node => node.id === "future").parents = ["query", "extra-8"];
  const copy = structuredClone(overflow); assert.equal(previewNodeDeletion(overflow, "query").canDelete, false);
  assert.throws(() => deleteNode(overflow, "query"), /8 个父节点/);
  assert.deepEqual(overflow, copy); assert.deepEqual(item, snapshot);
});

test("分支保留同查询记录时不把全局已完成步骤改成待查，删除处仍可重新检索", () => {
  const item = fixture(); item.commits.find(node => node.id === "side").description = "当前查询词";
  const next = deleteNode(item, "query");
  assert.equal(next.steps[0].status, "done");
  assert.equal(pendingSteps(next).length, 1);
  assert.equal(pendingSteps({ ...next, activeBranch: "side" }).length, 0);
});
