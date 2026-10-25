import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildResultTree } = await importTypeScript(path.join(root, "lib/result-tree.ts"));
const at = "2026-10-25T04:00:00.000Z";
const source = (id, stepId, kind = "search") => ({ id, stepId, title: id, url: `https://example.com/${id}`, snippet: "公开资料摘要", source: "web", relation: "context", kind, retrievedAt: at });
const record = (id, parents, stepId, evidenceIds, branch = "main", extra = {}) => ({ id, parents, stepId, evidenceIds, branch, title: id, description: stepId ? `查询${stepId}` : "原始问题", createdAt: at, type: stepId ? "search" : "init", searchMode: "live", ...extra });
function fixture() {
  return {
    id: "case-tree", title: "核查公开问题", input: "一个需要核对的说法", createdAt: at, updatedAt: at,
    activeBranch: "main", mode: "live", sources: ["web"],
    steps: ["a", "b", "c"].map(id => ({ id, title: `子问题${id}`, description: "核查方法", query: `查询${id}`, sources: ["web"], status: "done" })),
    evidence: [source("shared", "a"), source("main-only", "a"), source("side-only", "c"), source("manual", undefined, "manual"), source("orphan", "b")],
    branches: [{ id: "main", name: "main", head: "manual-record", color: "#258477" }, { id: "side", name: "寻找反证", head: "side-record", color: "#a28ac7" }],
    commits: [record("root", [], undefined, []), record("first", ["root"], "a", ["shared", "main-only"]), record("second", ["first"], "b", ["shared"]), record("side-record", ["first"], "c", ["side-only"], "side"), record("manual-record", ["second"], undefined, ["manual"], "main", { type: "evidence" })],
  };
}

test("结果树按当前分支可达记录分组，去重来源不会丢失跨子问题的引用", () => {
  const item = fixture(); const before = structuredClone(item);
  const tree = buildResultTree(item);
  assert.equal(tree.direction, "主线"); assert.equal(tree.sourceCount, 3); assert.equal(tree.searchCount, 2);
  assert.deepEqual(tree.groups.find(g => g.id === "a").sources.map(s => s.evidence.id), ["shared", "main-only"]);
  assert.deepEqual(tree.groups.find(g => g.id === "b").sources.map(s => s.evidence.id), ["shared"]);
  assert.equal(tree.groups.find(g => g.id === "b").sources[0].commitId, "second");
  assert.deepEqual(tree.groups.find(g => g.id === "unassigned:records").sources.map(s => s.evidence.id), ["manual"]);
  assert.deepEqual(tree.groups.find(g => g.id === "c").sources, []);
  assert.equal(tree.groups.find(g => g.id === "c").state, "pending");
  assert.deepEqual(item, before);
});

test("切换核验分支后不会混入主线未来来源，合并才纳入另一侧结果", () => {
  const item = fixture();
  const side = buildResultTree({ ...item, activeBranch: "side" });
  assert.equal(side.direction, "寻找反证"); assert.equal(side.isMain, false);
  assert.equal(side.groups.flatMap(g => g.sources).some(s => s.evidence.id === "manual"), false);
  assert.deepEqual(side.groups.find(g => g.id === "c").sources.map(s => s.evidence.id), ["side-only"]);
  const merged = { ...item, branches: item.branches.map(b => b.id === "main" ? { ...b, head: "merged" } : b), commits: [...item.commits, record("merged", ["manual-record", "side-record"], undefined, [], "main", { type: "merge" })] };
  assert.equal(buildResultTree(merged).sourceCount, 4);
  assert.equal(buildResultTree(merged).groups.find(g => g.id === "c").state, "found");
});

test("零结果、从未检索、改过查询与预置示例分别呈现，不把未找到当反驳", () => {
  const item = fixture();
  item.commits.push(record("empty", ["manual-record"], "b", [])); item.branches[0].head = "empty";
  let tree = buildResultTree(item);
  assert.equal(tree.groups.find(g => g.id === "b").state, "empty");
  assert.equal(tree.groups.find(g => g.id === "b").sources[0].evidence.id, "shared");
  item.steps[1].query = "改过的查询";
  tree = buildResultTree(item);
  assert.equal(tree.groups.find(g => g.id === "b").state, "changed");
  item.commits[1].searchMode = undefined; item.evidence[0].kind = "demo"; item.evidence[1].kind = "demo";
  tree = buildResultTree(item);
  assert.equal(tree.groups.find(g => g.id === "a").state, "sample"); assert.equal(tree.sampleSourceCount, 2);
  assert.equal(tree.liveSourceCount, 1);
});

test("没有所属步骤的零结果查询仍保留可打开的执行记录", () => {
  const item = fixture();
  item.commits.push(record("extra-empty", ["manual-record"], "removed-step", [])); item.branches[0].head = "extra-empty";
  const supplemental = buildResultTree(item).groups.find(g => g.id === "unassigned:records");
  assert.equal(supplemental.latestCommitId, "extra-empty"); assert.equal(supplemental.state, "empty"); assert.equal(supplemental.searchCount, 1);
  assert.deepEqual(supplemental.sources.map(s => s.evidence.id), ["manual"]);
});

test("无效分支不泄露任何档案来源，也不把共享完成状态当作此分支已检索", () => {
  const tree = buildResultTree({ ...fixture(), activeBranch: "missing" });
  assert.equal(tree.sourceCount, 0); assert.equal(tree.searchCount, 0);
  assert.equal(tree.groups.every(g => g.sources.length === 0 && g.state === "pending"), true);
});

test("旧档案没有真实检索标记时保留历史收录，不冒充预置示例或已验证调用", () => {
  const item = fixture();
  item.commits[1].searchMode = undefined;
  const tree = buildResultTree(item);
  assert.equal(tree.groups.find(g => g.id === "a").state, "recorded");
  assert.equal(tree.searchCount, 1); assert.equal(tree.sampleSourceCount, 0);
});

test("预置资料查询的说明不同于查询词时仍标为示例，真实重查后再调整查询才提示待重查", () => {
  const item = fixture();
  item.evidence[0].kind = "demo"; item.evidence[1].kind = "demo";
  item.commits[1].searchMode = undefined;
  item.commits[1].description = "已收录一条直接回应核心主张的预置资料。";
  assert.equal(buildResultTree(item).groups.find(g => g.id === "a").state, "sample");
  item.commits[1].searchMode = "live";
  assert.equal(buildResultTree(item).groups.find(g => g.id === "a").state, "changed");
  item.commits[1].description = item.steps[0].query;
  assert.equal(buildResultTree(item).groups.find(g => g.id === "a").state, "found");
});
