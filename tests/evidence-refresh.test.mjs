import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { applySearchResult, collectClues } = await importTypeScript(path.join(root, "lib/collection.ts"));
const { branchEvidence } = await importTypeScript(path.join(root, "lib/investigation.ts"));
const { evidenceFingerprint, saveBranchAnswer, isAnswerCurrent } = await importTypeScript(path.join(root, "lib/answers.ts"));
const { parseBackup } = await importTypeScript(path.join(root, "lib/validation.ts"));
const at = "2026-10-24T08:00:00.000Z";
const later = "2026-10-25T06:00:00.000Z";

function fixture(kind = "search") {
  return {
    id: "case-refresh", title: "核查月亮的可见条件", input: "为什么白天也能看见月亮？", createdAt: at, updatedAt: at,
    sources: ["official"], activeBranch: "main", mode: "live",
    steps: [1, 2].map(number => ({ id: `step-${number}`, title: `核验${number}`, description: "寻找原始说明", query: `月亮查询${number}`, sources: ["official"], status: number === 1 ? "done" : "pending" })),
    evidence: [{ id: "e-original", title: "历史资料标题", url: "https://science.nasa.gov/moon/", snippet: "旧导入说明：请打开原文核查。", source: "web", retrievedAt: at, publishedAt: "2024-01-01", relation: "contradicts", stepId: "step-1", kind, readerNote: "人工笔记：核对适用条件", customMetadata: { preserve: true } }],
    branches: [{ id: "main", name: "main", head: "c-old", color: "#258477" }, { id: "side", name: "旁支核验", head: "c-side", color: "#a28ac7" }],
    commits: [
      { id: "c-root", parents: [], evidenceIds: [], branch: "main", type: "init", title: "原始问题", description: "白天月亮", createdAt: at },
      { id: "c-old", parents: ["c-root"], evidenceIds: ["e-original"], branch: "main", type: "search", title: "旧查询", description: "月亮查询1", createdAt: at, stepId: "step-1", searchMode: "live", requestId: "request-old" },
      { id: "c-side", parents: ["c-root"], evidenceIds: ["e-original"], branch: "side", type: "evidence", title: "旁支引用同一来源", description: "共享资料", createdAt: at },
    ],
  };
}
function incoming(overrides = {}) {
  return { id: "e-provider-new-id", title: "NASA月亮公开说明", url: "https://science.nasa.gov/moon/", snippet: "本轮真实摘要：月亮的可见性取决于月相、位置与天空条件。", source: "official", retrievedAt: later, publishedAt: "2026-10-20", relation: "context", stepId: "step-2", kind: "search", ...overrides };
}
const live = results => ({ mode: "live", results, used: 1, requestId: "request-current" });

test("同URL真实复查刷新旧摘要并保留ID、人工关系、首次步骤和扩展笔记", () => {
  const item = fixture(); const snapshot = structuredClone(item);
  const next = applySearchResult(item, "step-2", live([incoming()]), "main");
  assert.equal(next.evidence.length, 1);
  assert.deepEqual(next.evidence[0], { ...snapshot.evidence[0], title: incoming().title, snippet: incoming().snippet, source: "official", retrievedAt: later, publishedAt: "2026-10-20" });
  assert.equal(next.evidence[0].id, "e-original"); assert.equal(next.evidence[0].relation, "contradicts"); assert.equal(next.evidence[0].stepId, "step-1");
  assert.equal(next.evidence[0].readerNote, snapshot.evidence[0].readerNote); assert.deepEqual(next.evidence[0].customMetadata, { preserve: true });
  assert.deepEqual(next.commits.at(-1).evidenceIds, ["e-original"]); assert.equal(next.commits.at(-1).title, "复核 1 条已收录资料");
  assert.equal(next.commits.at(-1).requestId, "request-current"); assert.equal(next.commits.at(-1).description, "月亮查询2");
  assert.deepEqual(item, snapshot); assert.notEqual(next.evidence[0], item.evidence[0]);
  // 当前数据模型共享资料快照，旁支仍引用同一编号并看到本轮更新。
  assert.equal(branchEvidence({ ...next, activeBranch: "side" })[0].snippet, incoming().snippet);
});

test("人工与演示资料在同URL复查时不被覆盖，仍仅引用原资料编号", () => {
  for (const kind of ["manual", "demo"]) {
    const item = fixture(kind); const snapshot = structuredClone(item);
    const next = applySearchResult(item, "step-2", live([incoming()]), "main");
    assert.equal(next.evidence.length, 1); assert.equal(next.evidence[0], item.evidence[0]);
    assert.deepEqual(next.evidence[0], snapshot.evidence[0]); assert.deepEqual(item, snapshot);
    assert.deepEqual(next.commits.at(-1).evidenceIds, ["e-original"]);
    assert.equal(next.commits.at(-1).requestId, "request-current");
  }
});

test("空摘要、空标题和缺失发布日期不会抹掉已保存内容", () => {
  const item = fixture(); const next = applySearchResult(item, "step-2", live([incoming({ title: "  ", snippet: "\n\t", source: "", retrievedAt: "", publishedAt: undefined })]), "main");
  assert.deepEqual(next.evidence[0], item.evidence[0]);
  const refreshed = applySearchResult(item, "step-2", live([incoming({ snippet: "", publishedAt: "  " })]), "main");
  assert.equal(refreshed.evidence[0].title, incoming().title); assert.equal(refreshed.evidence[0].snippet, item.evidence[0].snippet);
  assert.equal(refreshed.evidence[0].retrievedAt, later); assert.equal(refreshed.evidence[0].publishedAt, "2024-01-01");
});

test("单批同URL重复仍只引用一次，队列新增计数为零且每次复查留有请求记录", async () => {
  let current = fixture(); const progress = [];
  const summary = await collectClues({ read: () => current, save: value => { current = value; }, stepIds: ["step-2"], maxRequests: 1, search: async () => live([incoming(), incoming({ id: "e-provider-other-id", snippet: "同批最新的非空真实摘要" }), incoming({ id: "third-id", snippet: " " })]), onProgress: value => progress.push(value) });
  assert.deepEqual(summary, { completed: 1, total: 1, added: 0, reason: "completed" });
  assert.equal(current.evidence.length, 1); assert.equal(current.evidence[0].id, "e-original");
  assert.equal(current.evidence[0].snippet, "同批最新的非空真实摘要");
  assert.deepEqual(current.commits.at(-1).evidenceIds, ["e-original"]); assert.equal(current.commits.at(-1).requestId, "request-current");
  assert.equal(progress.at(-1).totalAdded, 0); assert.equal(progress.at(-1).added, 0);
});

test("摘要快照刷新即使不改变历史，也会使旧可能答案的证据指纹过期", () => {
  const original = fixture();
  const item = saveBranchAnswer(original, { answer: "先依据旧资料作出初步判断", verdict: "supported", reason: "旧资料暂时支持，仍需核读", limitations: ["尚未复查来源"], evidenceIds: ["e-original"] });
  const answer = item.answers[0]; assert.equal(isAnswerCurrent(item, answer), true);
  const next = applySearchResult(item, "step-2", live([incoming()]), "main");
  const refreshedSnapshotOnly = { ...item, evidence: next.evidence };
  assert.notEqual(evidenceFingerprint(refreshedSnapshotOnly), evidenceFingerprint(item));
  assert.equal(isAnswerCurrent(refreshedSnapshotOnly, answer), false); assert.equal(isAnswerCurrent(next, answer), false);
  assert.equal(next.answers, item.answers);
  // 备份校验允许保留过期答案及其原引用，扩展笔记字段会按既有白名单剥离。
  const imported = parseBackup([next])[0]; assert.equal(imported.evidence[0].snippet, incoming().snippet);
  assert.equal(imported.answers[0].fingerprint, answer.fingerprint);
});
