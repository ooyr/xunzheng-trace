import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { branchCommits, branchEvidence, appendCommit, makeReport, createDemo } = await importTypeScript(path.join(root, "lib/investigation.ts"));
const { classifySource, allowedSource } = await importTypeScript(path.join(root, "lib/server/sources.ts"));

function fixture() {
  const at = "2026-10-24T08:00:00.000Z";
  const evidence = ["root", "main", "future", "side", "orphan"].map(name => ({ id: `ev-${name}`, title: `证据-${name}`, url: `https://example.com/${name}`, snippet: `摘录-${name}`, source: "web", retrievedAt: at, relation: "context", kind: "manual" }));
  const commit = (name, parents, evidenceIds, branch = "main") => ({ id: `c-${name}`, parents, evidenceIds, branch, title: `记录-${name}`, description: "测试调查记录", type: "evidence", createdAt: at });
  return {
    id: "test-case", title: "测试调查", input: "需要证据支持的主张", createdAt: at, updatedAt: at,
    sources: ["web"], steps: [], evidence, mode: "live", activeBranch: "main",
    branches: [{ id: "main", name: "main", head: "c-future", color: "#258477" }, { id: "side", name: "独立反证", head: "c-side", color: "#a28ac7" }],
    commits: [
      commit("root", [], ["ev-root"]),
      commit("fork", ["c-root"], []),
      commit("main", ["c-fork"], ["ev-main"]),
      commit("future", ["c-main"], ["ev-future"]),
      commit("side", ["c-fork"], ["ev-root", "ev-side", "ev-side"], "side"),
      commit("orphan", [], ["ev-orphan"], "abandoned"),
    ],
  };
}

test("分支回溯只呈现从head可达的记录和证据", () => {
  const item = fixture();
  assert.deepEqual(branchCommits(item).map(commit => commit.id), ["c-root", "c-fork", "c-main", "c-future"]);
  assert.deepEqual(branchEvidence(item).map(evidence => evidence.id), ["ev-root", "ev-main", "ev-future"]);
  const side = { ...item, activeBranch: "side" };
  assert.deepEqual(branchCommits(side).map(commit => commit.id), ["c-root", "c-fork", "c-side"]);
  assert.deepEqual(branchEvidence(side).map(evidence => evidence.id), ["ev-root", "ev-side"]);
  assert.deepEqual(branchCommits(item, "missing-branch"), []);
});

test("从历史节点创建的分支看不到未来或旁支证据", () => {
  const item = fixture();
  const history = { ...item, activeBranch: "history", branches: [...item.branches, { id: "history", name: "回到拆解时", head: "c-fork", color: "#8899aa" }] };
  assert.deepEqual(branchCommits(history).map(commit => commit.id), ["c-root", "c-fork"]);
  assert.deepEqual(branchEvidence(history).map(evidence => evidence.id), ["ev-root"]);
  assert.equal(branchEvidence(history).some(evidence => evidence.id === "ev-future"), false);
  assert.equal(branchEvidence(history).some(evidence => evidence.id === "ev-side"), false);
});

test("appendCommit推进当前分支head，同时保留其它分支和原对象", () => {
  const item = fixture();
  const snapshot = structuredClone(item);
  const next = appendCommit(item, { title: "补充查询", description: "继续核验", type: "search", evidenceIds: [], stepId: "step-extra" });
  const added = next.commits.at(-1);
  assert.equal(next.commits.length, item.commits.length + 1);
  assert.deepEqual(added.parents, ["c-future"]);
  assert.equal(added.branch, "main");
  assert.equal(next.branches.find(branch => branch.id === "main").head, added.id);
  assert.deepEqual(next.branches.find(branch => branch.id === "side"), item.branches.find(branch => branch.id === "side"));
  assert.equal(next.updatedAt, added.createdAt);
  assert.deepEqual(item, snapshot);
});

test("双父合并保留两条历史，证据集合去重且排除不可达来源", () => {
  const item = fixture();
  const merged = appendCommit(item, { title: "合并反证调查", description: "合并两条证据链", type: "merge", evidenceIds: [] }, "c-side");
  const merge = merged.commits.at(-1);
  assert.deepEqual(merge.parents, ["c-future", "c-side"]);
  assert.deepEqual(branchEvidence(merged).map(evidence => evidence.id), ["ev-root", "ev-main", "ev-future", "ev-side"]);
  assert.equal(branchEvidence(merged).filter(evidence => evidence.id === "ev-root").length, 1);
  assert.equal(branchEvidence(merged).filter(evidence => evidence.id === "ev-side").length, 1);
  assert.equal(branchEvidence(merged).some(evidence => evidence.id === "ev-orphan"), false);
  assert.equal(merged.branches.find(branch => branch.id === "side").head, "c-side");
});

test("相同的合并父节点只记录一次", () => {
  const item = fixture();
  const merged = appendCommit(item, { title: "重复父节点", description: "不重复记录同一父节点", type: "merge", evidenceIds: [] }, "c-future");
  assert.deepEqual(merged.commits.at(-1).parents, ["c-future"]);
});

test("无可达证据的报告明确证据不足，不引用其它分支存量", () => {
  const item = fixture();
  const empty = { ...item, activeBranch: "history", branches: [...item.branches, { id: "history", name: "尚无证据", head: "c-fork", color: "#8899aa" }], commits: item.commits.map(commit => commit.id === "c-root" ? { ...commit, evidenceIds: [] } : commit) };
  const report = makeReport(empty);
  assert.match(report, /证据不足。目前没有可引用来源，无法对主张作出判断/);
  assert.doesNotMatch(report, /证据-main|证据-future|证据-side|证据-orphan/);
  assert.doesNotMatch(report, /演示档案/);
});

test("示例报告说明预置资料，不冒充已完成真实API查询", () => {
  const demo = createDemo();
  const report = makeReport(demo);
  assert.match(report, /演示档案：含预置示例或模板步骤，不代表已完成真实 API 查询/);
  assert.match(report, /数据类型：预置演示资料/);
  assert.match(report, /不等于最终事实裁定/);
  assert.doesNotMatch(report, /数据类型：搜索接口返回/);
});

test("赛事和接入文档官网属于精选官方范围，不泛化整个qq.com", () => {
  const officialUrls = [
    "https://1024.waytoagi.com/tracks/detective",
    "https://toklens.ai/zh/manual",
    "https://cloud.tencent.com/document/product/1806/130615",
    "https://developers.weixin.qq.com/doc/service/guide/",
    "https://developer.work.weixin.qq.com/document/path/101463",
  ];
  for (const url of officialUrls) assert.equal(allowedSource(url, ["official"]), "official");
  assert.equal(classifySource("https://qq.com/a"), "web");
  assert.equal(classifySource("https://user.qq.com/a"), "web");
  assert.equal(allowedSource("https://developers.weixin.qq.com.evil.example/a", ["official"]), null);
  assert.equal(allowedSource("https://cloud.tencent.com.evil.example/a", ["official"]), null);
});
