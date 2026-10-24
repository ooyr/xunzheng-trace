import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { applySearchResult, collectClues, pendingSteps, recoverInterrupted } = await importTypeScript(path.join(root, "lib/collection.ts"));
const { branchEvidence, createDemo } = await importTypeScript(path.join(root, "lib/investigation.ts"));
const { parseBackup } = await importTypeScript(path.join(root, "lib/validation.ts"));
const at = "2026-10-24T08:00:00.000Z";

function fixture(count = 3) {
  return {
    id: "case-test", title: "核验公开说法", input: "这条说法是否有证据？", createdAt: at, updatedAt: at,
    sources: ["web"], mode: "live", activeBranch: "main", evidence: [],
    steps: Array.from({ length: count }, (_, index) => ({ id: `step-${index + 1}`, title: `核验步骤 ${index + 1}`, description: "寻找原始来源", query: `query-${index + 1}`, sources: ["web"], status: "pending" })),
    branches: [{ id: "main", name: "main", head: "c-root", color: "#258477" }, { id: "side", name: "独立核验", head: "c-root", color: "#a28ac7" }],
    commits: [{ id: "c-root", parents: [], branch: "main", title: "建立调查", description: "记录原始问题", type: "init", createdAt: at, evidenceIds: [] }],
  };
}
function result(id, url = `https://example.com/${id}`) {
  return { id, title: `来源 ${id}`, url, snippet: `原始摘要 ${id}`, source: "web", retrievedAt: at, relation: "context", kind: "search" };
}
const live = (results = [], requestId) => ({ mode: "live", results, ...(requestId ? { requestId } : {}) });
function store(initial) {
  let item = initial;
  return { read: () => item, save: (next) => { item = next; } };
}

test("待查步骤按目标分支可达查询判断，受阻可重试，演示模板的完成状态仍可执行", () => {
  const item = fixture(4);
  item.steps[0].status = "done"; item.steps[1].status = "blocked"; item.steps[2].status = "running"; item.steps[3].status = "done";
  const searchCommit = (id, branch, stepId, description) => ({ id, parents: ["c-root"], branch, title: "已有查询", description, type: "search", createdAt: at, evidenceIds: [], stepId });
  item.commits.push(searchCommit("c-side", "side", "step-1", "query-1"), searchCommit("c-main", "main", "step-2", "query-2"));
  item.branches[0].head = "c-main"; item.branches[1].head = "c-side";
  assert.deepEqual(pendingSteps(item).map(step => step.id), ["step-1", "step-2", "step-4"]);
  assert.deepEqual(pendingSteps(item, "side").map(step => step.id), ["step-2", "step-4"]);
  assert.equal(pendingSteps(createDemo()).length, 4);
});

test("自动收集即时保存真实资料及提交引用，并通知新节点和进度", async () => {
  const state = store(fixture(2)); const progress = []; const commits = [];
  const summary = await collectClues({ ...state, search: async request => live([result(`e-${request.stepId}`)], `request-${request.stepId}`), onProgress: value => progress.push(value), onCommit: id => commits.push(id) });
  const item = state.read();
  assert.deepEqual(summary, { completed: 2, total: 2, added: 2, reason: "completed" });
  assert.equal(item.evidence.length, 2);
  assert.deepEqual(item.steps.map(step => step.status), ["done", "done"]);
  assert.deepEqual(progress.map(value => value.phase), ["searching", "saved", "searching", "saved"]);
  assert.deepEqual(progress.filter(value => value.phase === "saved").map(value => value.totalAdded), [1, 2]);
  assert.deepEqual(commits, item.commits.slice(1).map(commit => commit.id));
  for (const commit of item.commits.slice(1)) {
    assert.equal(commit.searchMode, "live"); assert.equal(commit.requestId, `request-${commit.stepId}`);
    assert.deepEqual(commit.evidenceIds, [`e-${commit.stepId}`]);
    assert.equal(item.evidence.find(entry => entry.id === commit.evidenceIds[0]).stepId, commit.stepId);
  }
});

test("历史与单批重复URL只引用一份资料，保留已有人工标记并排除无效链接", () => {
  const item = fixture(1); const existing = { ...result("existing", "https://example.com/known"), kind: "manual", relation: "supports" };
  item.evidence = [existing]; const original = structuredClone(item);
  const next = applySearchResult(item, "step-1", live([result("another", existing.url), result("first", "https://example.com/new"), result("duplicate", "https://example.com/new"), result("invalid", "javascript:alert(1)")]), "main");
  assert.equal(next.evidence.length, 2);
  assert.deepEqual(next.commits.at(-1).evidenceIds, ["existing", "first"]);
  assert.deepEqual(next.evidence[0], existing);
  assert.deepEqual(item, original);
});

test("不同URL的返回ID碰撞时生成新ID，提交不会引用错误资料", () => {
  const item = fixture(1); item.evidence = [result("collision", "https://example.com/old")];
  const next = applySearchResult(item, "step-1", live([result("collision", "https://example.com/new-one"), result("collision", "https://example.com/new-two")]), "main");
  assert.equal(new Set(next.evidence.map(entry => entry.id)).size, 3);
  assert.equal(next.commits.at(-1).evidenceIds.length, 2);
  assert.deepEqual(next.commits.at(-1).evidenceIds.map(id => next.evidence.find(entry => entry.id === id).url), ["https://example.com/new-one", "https://example.com/new-two"]);
});

test("结果只推进指定分支，保留正在查看的分支与其它分支证据范围", () => {
  const item = fixture(1);
  const next = applySearchResult(item, "step-1", live([result("e-side")]), "side");
  assert.equal(next.activeBranch, "main");
  assert.equal(next.branches[0].head, "c-root");
  assert.equal(next.branches[1].head, next.commits.at(-1).id);
  assert.deepEqual(next.commits.at(-1).parents, ["c-root"]);
  assert.equal(next.commits.at(-1).branch, "side");
  assert.deepEqual(branchEvidence(next), []);
  assert.deepEqual(branchEvidence({ ...next, activeBranch: "side" }).map(entry => entry.id), ["e-side"]);
});

test("实际执行快照写入查询记录，途中变更查询或来源保留待查，来源换序不重复执行", () => {
  const item = fixture(1); item.steps[0].query = "edited-query"; item.steps[0].sources = ["news"];
  const changed = applySearchResult(item, "step-1", live([result("e-snapshot")]), "main", { query: "sent-query", sources: ["web"] });
  assert.equal(changed.commits.at(-1).description, "sent-query"); assert.equal(changed.steps[0].query, "edited-query"); assert.equal(changed.steps[0].status, "pending");
  const reordered = fixture(1); reordered.steps[0].sources = ["news", "web"];
  assert.equal(applySearchResult(reordered, "step-1", live(), "main", { query: "query-1", sources: ["web", "news"] }).steps[0].status, "done");
  const fallback = fixture(1); fallback.steps[0].sources = []; fallback.sources = ["news"];
  assert.equal(applySearchResult(fallback, "step-1", live(), "main", { query: "query-1", sources: ["web"] }).steps[0].status, "pending");
});

test("runner保存真实发出的查询，保留在途编辑而不把新查询误标完成", async () => {
  const state = store(fixture(1)); let request;
  await collectClues({ ...state, search: async value => { request = value; const current = state.read(); state.save({ ...current, title: "人工修改标题", steps: current.steps.map(step => ({ ...step, query: "new-query", sources: ["news"], status: "pending" })) }); return live([result("e-inflight")]); } });
  assert.equal(request.query, "query-1"); assert.deepEqual(request.sources, ["web"]);
  assert.equal(state.read().commits.at(-1).description, "query-1");
  assert.equal(state.read().title, "人工修改标题"); assert.equal(state.read().steps[0].status, "pending");
  assert.equal(state.read().evidence.length, 1);
});

test("默认队列执行下一步前跳过已被其它操作完成的查询", async () => {
  const state = store(fixture(3)); const calls = [];
  await collectClues({ ...state, search: async request => { calls.push(request.stepId); if (request.stepId === "step-1") state.save(applySearchResult(state.read(), "step-2", live([result("e-other")]), "main")); return live([result(`e-${request.stepId}`)]); } });
  assert.deepEqual(calls, ["step-1", "step-3"]);
  assert.equal(state.read().commits.filter(commit => commit.stepId === "step-2").length, 1);
});

test("显式单步允许重查完成步骤，但不会接管仍在执行的步骤", async () => {
  const initial = applySearchResult(fixture(2), "step-1", live(), "main"); initial.steps[1].status = "running";
  const state = store(initial); const calls = [];
  await collectClues({ ...state, stepIds: ["step-1", "step-1", "step-2"], search: async request => { calls.push(request.stepId); return live(); } });
  assert.deepEqual(calls, ["step-1"]); assert.equal(state.read().steps[1].status, "running");
});

test("请求严格串行，下一步读到前一步提交与最新计划编辑", async () => {
  const state = store(fixture(2)); let inFlight = 0; let maximum = 0; const calls = []; const events = [];
  await collectClues({ ...state, onProgress: value => events.push(`${value.phase}:${value.stepId}`), search: async request => {
    inFlight += 1; maximum = Math.max(maximum, inFlight); calls.push(request);
    if (request.stepId === "step-2") { assert.equal(state.read().evidence.length, 1); assert.equal(state.read().commits.at(-1).stepId, "step-1"); }
    await Promise.resolve();
    if (request.stepId === "step-1") { const item = state.read(); state.save({ ...item, steps: item.steps.map(step => step.id === "step-2" ? { ...step, query: "latest-query", sources: ["news"] } : step) }); }
    inFlight -= 1; return live([result(`e-${request.stepId}`)]);
  } });
  assert.equal(maximum, 1); assert.equal(calls[1].query, "latest-query"); assert.deepEqual(calls[1].sources, ["news"]);
  assert.deepEqual(events, ["searching:step-1", "saved:step-1", "searching:step-2", "saved:step-2"]);
  assert.deepEqual(state.read().commits[2].parents, [state.read().commits[1].id]);
});

test("默认及超过上限的预算均最多发出六次请求，剩余步骤保持待查", async () => {
  for (const maxRequests of [undefined, 100]) {
    const state = store(fixture(8)); let calls = 0;
    const summary = await collectClues({ ...state, maxRequests, search: async () => { calls += 1; return live(); } });
    assert.equal(calls, 6); assert.equal(summary.reason, "limit"); assert.equal(summary.completed, 6);
    assert.deepEqual(state.read().steps.slice(6).map(step => step.status), ["pending", "pending"]);
  }
});

test("暂停保存在途结果与提交，然后停止后续请求", async () => {
  const state = store(fixture(3)); let stopped = false; let resolveSearch; let calls = 0;
  const pending = collectClues({ ...state, shouldStop: () => stopped, search: () => { calls += 1; return new Promise(resolve => { resolveSearch = resolve; }); } });
  assert.equal(state.read().steps[0].status, "running"); stopped = true; resolveSearch(live([result("e-paused")]));
  const summary = await pending;
  assert.deepEqual(summary, { completed: 1, total: 3, added: 1, reason: "stopped" });
  assert.equal(calls, 1); assert.equal(state.read().evidence[0].id, "e-paused");
  assert.deepEqual(state.read().steps.map(step => step.status), ["done", "pending", "pending"]);
});

test("首次错误停止且不重试，保留先前结果并只阻塞当前步骤", async () => {
  const state = store(fixture(3)); let calls = 0;
  const summary = await collectClues({ ...state, search: async () => { calls += 1; if (calls === 2) throw new Error("模拟额度耗尽"); return live([result("e-before-error")]); } });
  assert.equal(summary.reason, "error"); assert.match(summary.message, /模拟额度耗尽/); assert.equal(summary.completed, 1); assert.equal(calls, 2);
  assert.equal(state.read().evidence.length, 1); assert.equal(state.read().commits.length, 2);
  assert.deepEqual(state.read().steps.map(step => step.status), ["done", "blocked", "pending"]);
});

test("未配置服务立即停止，不把返回占位内容计为真实结果或成功提交", async () => {
  const state = store(fixture(3)); let calls = 0;
  const summary = await collectClues({ ...state, search: async () => { calls += 1; return { mode: "unconfigured", results: [result("must-not-save")], notice: "尚未配置" }; } });
  assert.equal(summary.reason, "unconfigured"); assert.equal(summary.completed, 0); assert.equal(summary.added, 0); assert.equal(calls, 1);
  assert.equal(state.read().evidence.length, 0); assert.equal(state.read().commits.length, 1);
  assert.deepEqual(state.read().steps.map(step => step.status), ["blocked", "pending", "pending"]);
});

test("恢复中断状态后可以继续检索，并保留完成状态和更新时间", async () => {
  const initial = fixture(3); initial.steps[0].status = "running"; initial.steps[1].status = "blocked";
  const restored = recoverInterrupted(initial);
  assert.equal(initial.steps[0].status, "running"); assert.equal(restored.updatedAt, initial.updatedAt);
  assert.deepEqual(restored.steps.map(step => step.status), ["pending", "blocked", "pending"]);
  assert.equal(recoverInterrupted(restored), restored);
  const state = store(restored); const summary = await collectClues({ ...state, maxRequests: 1, search: async () => live([result("e-recovered")]) });
  assert.equal(summary.completed, 1); assert.equal(state.read().steps[0].status, "done");
});

test("无结果真实查询仍留明确记录，新标记可经备份校验保留且兼容旧示例", () => {
  const next = applySearchResult({ ...fixture(1), mode: "demo" }, "step-1", live([], "request-real-123"), "main");
  const commit = next.commits.at(-1);
  assert.equal(commit.searchMode, "live"); assert.equal(commit.requestId, "request-real-123"); assert.deepEqual(commit.evidenceIds, []);
  assert.match(commit.title, /未发现有效线索/); assert.equal(next.mode, "live");
  const parsed = parseBackup(JSON.parse(JSON.stringify(next)))[0];
  assert.equal(parsed.commits.at(-1).searchMode, "live"); assert.equal(parsed.commits.at(-1).requestId, "request-real-123");
  assert.equal(parseBackup(createDemo())[0].commits[0].searchMode, undefined);
  assert.throws(() => parseBackup({ ...next, commits: next.commits.map(entry => entry.id === commit.id ? { ...entry, searchMode: "demo" } : entry) }), /检索模式/);
  assert.throws(() => parseBackup({ ...next, commits: next.commits.map(entry => entry.id === commit.id ? { ...entry, requestId: " " } : entry) }), /请求标识/);
});

test("当前步骤中途删除时安全停止，不继续消耗后续请求", async () => {
  const state = store(fixture(2)); let calls = 0;
  const summary = await collectClues({ ...state, search: async () => { calls += 1; const item = state.read(); state.save({ ...item, steps: item.steps.slice(1) }); return live([result("e-deleted")]); } });
  assert.equal(summary.reason, "error"); assert.equal(calls, 1); assert.equal(state.read().steps[0].status, "pending");
});
