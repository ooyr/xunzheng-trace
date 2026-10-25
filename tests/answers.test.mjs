import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTypeScript } from "./load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const answers = await importTypeScript(path.join(root, "lib/answers.ts"));
const { generateBranchAnswer, validateAnswerRequest } = await importTypeScript(path.join(root, "lib/server/answer.ts"));
const { parseBackup } = await importTypeScript(path.join(root, "lib/validation.ts"));
const { makeReport } = await importTypeScript(path.join(root, "lib/investigation.ts"));
const { POST } = await importTypeScript(path.join(root, "app/api/answer/route.ts"));
const at = "2026-10-25T01:00:00.000Z";
function fixture() {
  const evidence = ["root", "main", "side", "demo"].map(name => ({ id: `e-${name}`, title: `资料${name}`, url: `https://science.nasa.gov/${name}`, snippet: `原始资料说明${name}，不能省略观察条件。`, source: "official", retrievedAt: at, relation: "context", kind: name === "demo" ? "demo" : "search", stepId: "step-1" }));
  return { id: "case-answer", title: "核查公开说法", input: "这个说法适用于哪些条件？", createdAt: at, updatedAt: at, sources: ["official"], activeBranch: "main", mode: "live", steps: [{ id: "step-1", title: "核对原文", description: "查找条件", query: "条件 NASA", sources: ["official"], status: "done" }], evidence,
    commits: [{ id: "c-root", parents: [], branch: "main", title: "原始说法", description: "原始问题", type: "init", createdAt: at, evidenceIds: ["e-root", "e-demo"] }, { id: "c-main", parents: ["c-root"], branch: "main", title: "实际查询", description: "条件 NASA", type: "search", stepId: "step-1", searchMode: "live", createdAt: at, evidenceIds: ["e-main"] }, { id: "c-side", parents: ["c-root"], branch: "side", title: "旁支查询", description: "另一条件", type: "search", stepId: "step-1", searchMode: "live", createdAt: at, evidenceIds: ["e-side"] }],
    branches: [{ id: "main", name: "main", head: "c-main", color: "#258477" }, { id: "side", name: "另一解释", head: "c-side", color: "#a28ac7" }] };
}
const manual = (overrides = {}) => ({ answer: "可能与观察条件有关。", verdict: "supported", reason: "机构原文说明了适用范围。", limitations: ["仍须核对完整原文。"], evidenceIds: ["e-main"], ...overrides });
async function configured(run) {
  const names = ["TOKLENS_API_KEY", "TOKLENS_MODEL", "TOKLENS_BASE_URL"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { TOKLENS_API_KEY: "answer-test-key", TOKLENS_MODEL: "configured-model", TOKLENS_BASE_URL: "https://lax.toklens.ai/v1" });
  try { return await run(); } finally { for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]; }
}
const model = value => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

test("答案只引用本分支可达真实资料，不接受旁支或演示来源", () => {
  const item = fixture();
  assert.deepEqual(answers.answerEvidence(item).map(entry => entry.id), ["e-root", "e-main"]);
  assert.deepEqual(answers.answerEvidence(item, "side").map(entry => entry.id), ["e-root", "e-side"]);
  for (const id of ["e-side", "e-demo", "missing"]) assert.throws(() => answers.saveBranchAnswer(item, manual({ evidenceIds: [id] })), /当前分支/);
  assert.throws(() => answers.saveBranchAnswer(item, manual({ evidenceIds: [] })), /至少一条/);
  const empty = answers.saveBranchAnswer(item, manual({ verdict: "insufficient", evidenceIds: [] }));
  assert.equal(answers.getBranchAnswer(empty).verdict, "insufficient");
});

test("手工答案按分支保存、可备份往返，修改资料或查询后过期而不丢失历史", () => {
  const initial = fixture(); const snapshot = structuredClone(initial);
  const saved = answers.saveBranchAnswer(initial, manual()); const value = answers.getBranchAnswer(saved);
  assert.equal(value.origin, "manual"); assert.equal(answers.isAnswerCurrent(saved, value), true);
  assert.deepEqual(initial, snapshot); assert.deepEqual(parseBackup(saved), [saved]);
  for (const mutate of [item => item.input += "补充条件", item => item.steps[0].query += " 时间", item => item.evidence[0].snippet += "相反资料", item => item.commits[1].parents = []]) {
    const changed = structuredClone(saved); mutate(changed);
    assert.equal(answers.isAnswerCurrent(changed, value), false);
  }
  const annotation = structuredClone(saved); annotation.commits[1].note = "人工笔记"; annotation.commits[1].title = "修改显示标题";
  assert.equal(answers.isAnswerCurrent(annotation, value), true);
  assert.equal(parseBackup(annotation)[0].commits[1].note, "人工笔记");
  const side = answers.saveBranchAnswer(saved, manual({ evidenceIds: ["e-side"] }), { branchId: "side" });
  assert.equal(side.answers.length, 2); assert.equal(answers.getBranchAnswer(side).branchId, "main");
});

test("导入拒绝虚构引用与原型字段，删除节点后的过期答案可保留但不能作为当前结论", () => {
  const saved = answers.saveBranchAnswer(fixture(), manual());
  const forged = structuredClone(saved); forged.answers[0].evidenceIds = ["e-side"];
  assert.throws(() => parseBackup(forged), /不属于当前分支/);
  const hidden = structuredClone(saved); hidden.answers[0].evidenceIds = ["e-demo"];
  assert.throws(() => parseBackup(hidden), /演示资料/);
  const corrupt = structuredClone(saved); corrupt.answers[0].fingerprint = "invalid";
  assert.throws(() => parseBackup(corrupt), /指纹/);
  const inherited = structuredClone(saved); Object.defineProperty(inherited.answers[0], "reason", { get: () => { throw new Error("不可执行"); } });
  assert.throws(() => parseBackup(inherited), /访问器/);
  const removed = structuredClone(saved); removed.commits = removed.commits.filter(entry => entry.id !== "c-main"); removed.branches[0].head = "c-root";
  const loaded = parseBackup(removed)[0]; assert.equal(answers.isAnswerCurrent(loaded, loaded.answers[0]), false);
  const report = makeReport(loaded); assert.match(report, /答案已过期/); assert.doesNotMatch(report, /可能与观察条件有关/);
  const current = makeReport(saved); assert.match(current, /可能与观察条件有关/); assert.match(current, /https:\/\/science.nasa.gov\/main/); assert.match(current, /仍须核对完整原文/);
});

test("模型仅收到当前分支既有摘要，一次调用返回有引用的候选答案，不额外搜索", async () => {
  await configured(async () => {
    let calls = 0;
    const value = await generateBranchAnswer(fixture(), "main", async (url, options) => {
      calls++; assert.equal(url, "https://lax.toklens.ai/v1/chat/completions"); assert.equal(options.redirect, "manual");
      const payload = JSON.parse(options.body); assert.equal(payload.model, "configured-model");
      const data = JSON.parse(payload.messages[1].content);
      assert.deepEqual(data.evidence.map(entry => entry.id), ["e-root", "e-main"]);
      assert.match(payload.messages[0].content, /不编造事实或引用/);
      return model(manual());
    });
    assert.equal(calls, 1); assert.equal(value.origin, "model"); assert.equal(value.verdict, "supported");
    assert.deepEqual(value.evidenceIds, ["e-main"]); assert.ok(value.limitations.some(entry => entry.includes("未读取完整网页")));
    assert.equal(answers.isAnswerCurrent(fixture(), value), true);
  });
});

test("未知引用、无引用和夹带新链接的模型断言降为证据不足，不展示未经支持的答案", async () => {
  await configured(async () => {
    for (const raw of [manual({ evidenceIds: ["e-side"] }), manual({ evidenceIds: [] }), manual({ verdict: "insufficient", answer: "无引用但仍断言发生了事故", evidenceIds: [] }), manual({ reason: "结论见 https://fake.example/new" })]) {
      const answer = await generateBranchAnswer(fixture(), "main", async () => model(raw));
      assert.equal(answer.verdict, "insufficient"); assert.deepEqual(answer.evidenceIds, []);
      assert.equal(answer.answer, "目前证据不足，无法给出可靠的可能答案。");
    }
    const item = fixture(); item.evidence = item.evidence.map(entry => ({ ...entry, source: "web", url: `https://example.com/${entry.id}` }));
    const weak = await generateBranchAnswer(item, "main", async () => model(manual()));
    assert.equal(weak.verdict, "insufficient"); assert.match(weak.reason, /单一非机构来源/);
  });
});

test("人工伪标official不能把单一非机构来源变成权威，模型只收到实际域名分类", async () => {
  await configured(async () => {
    for (const url of ["https://example.com/manual", "https://nasa.gov.evil.example/manual"]) {
      const item = fixture();
      item.evidence = item.evidence.map(entry => entry.id === "e-main" ? { ...entry, source: "official", kind: "manual", url } : entry);
      const result = await generateBranchAnswer(item, "main", async (_url, options) => {
        const data = JSON.parse(JSON.parse(options.body).messages[1].content);
        assert.equal(data.evidence.find(entry => entry.id === "e-main").source, "web");
        return model(manual());
      });
      assert.equal(result.verdict, "insufficient"); assert.match(result.reason, /单一非机构来源/);
      assert.equal(item.evidence.find(entry => entry.id === "e-main").source, "official");
    }
  });
});

test("没有真实资料或未配置模型时明确拒绝，失败及重定向不重试、不泄露上游内容", async () => {
  const item = fixture(); item.evidence = item.evidence.map(entry => ({ ...entry, kind: "demo" }));
  await assert.rejects(generateBranchAnswer(item, "main", async () => { throw new Error("不应联网"); }), { code: "NO_ANSWER_EVIDENCE" });
  await configured(async () => {
    delete process.env.TOKLENS_API_KEY;
    await assert.rejects(generateBranchAnswer(fixture(), "main", async () => { throw new Error("不应联网"); }), { code: "ANSWER_MODEL_UNCONFIGURED" });
    process.env.TOKLENS_API_KEY = "answer-test-key";
    for (const status of [301, 302, 401, 403, 429]) {
      let calls = 0;
      await assert.rejects(generateBranchAnswer(fixture(), "main", async (_url, options) => { calls++; assert.equal(options.redirect, "manual"); return new Response("secret answer-test-key", { status, headers: { Location: "https://unrelated.example" } }); }), error => error.code === "UPSTREAM_ERROR" && !error.message.includes("answer-test-key") && !error.message.includes("unrelated"));
      assert.equal(calls, 1);
    }
  });
});

test("请求校验拒绝多个档案和不存在分支，跨站模型入口先拒绝且不访问登录存储", async () => {
  assert.equal(validateAnswerRequest({ investigation: fixture() }).branchId, "main");
  assert.throws(() => validateAnswerRequest({ investigation: [fixture(), fixture()] }), { code: "INVALID_ANSWER_INVESTIGATION" });
  assert.throws(() => validateAnswerRequest({ investigation: fixture(), branchId: "missing" }), { code: "INVALID_ANSWER_BRANCH" });
  const response = await POST(new Request("https://trace.example/api/answer", { method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: JSON.stringify({ investigation: fixture() }) }));
  assert.equal(response.status, 403);
});
