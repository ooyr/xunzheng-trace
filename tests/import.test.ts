import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Investigation } from "../lib/types";
import { importTypeScript } from "./load-typescript.mjs";

const { parseBackup } = await importTypeScript(fileURLToPath(new URL("../lib/validation.ts", import.meta.url))) as typeof import("../lib/validation");
const { createDemo } = await importTypeScript(fileURLToPath(new URL("../lib/investigation.ts", import.meta.url))) as typeof import("../lib/investigation");

function demo(): Investigation {
  return structuredClone(createDemo());
}

test("有效演示、原有本地列表、导出包装和单份档案都可导入", () => {
  const original = demo();
  assert.deepEqual(parseBackup([original]), [original]);
  assert.deepEqual(parseBackup({ version: 1, cases: [original] }), [original]);
  assert.deepEqual(parseBackup(original), [original]);
  assert.match(parseBackup([original])[0].evidence[0].retrievedAt, /预置示例/);
  assert.deepEqual(parseBackup([]), []);
});

test("剥离所有未知字段，不复制原型污染字段或保留输入对象引用", () => {
  const raw = JSON.parse(JSON.stringify(demo())) as Investigation & Record<string, unknown>;
  Object.defineProperty(raw, "__proto__", { enumerable: true, value: { polluted: true } });
  raw.constructor = { prototype: { polluted: true } } as never;
  raw.extra = { secret: "不应导入" };
  Object.assign(raw.steps[0], { extra: "不应导入" });
  const parsed = parseBackup([raw])[0];
  assert.equal(Object.hasOwn(parsed, "__proto__"), false);
  assert.equal(Object.hasOwn(parsed, "constructor"), false);
  assert.equal(Object.hasOwn(parsed, "extra"), false);
  assert.equal(Object.hasOwn(parsed.steps[0], "extra"), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  parsed.steps[0].title = "新的标题";
  assert.notEqual(parsed.steps[0].title, raw.steps[0].title);
});

test("拒绝继承的必填字段和访问器字段", () => {
  assert.throws(() => parseBackup(Object.create(demo())), /普通数据对象/);
  const raw = demo();
  Object.defineProperty(raw, "title", { get: () => { throw new Error("不应执行访问器"); } });
  assert.throws(() => parseBackup([raw]), /访问器字段/);
});

test("拒绝重复档案、步骤、证据、提交和分支标识", () => {
  const raw = demo();
  assert.throws(() => parseBackup([raw, raw]), /重复标识/);
  for (const key of ["steps", "evidence", "commits", "branches"] as const) {
    const changed = demo();
    (changed[key] as unknown[]).push(structuredClone(changed[key][0]));
    assert.throws(() => parseBackup([changed]), /重复标识/, key);
  }
});

test("拒绝错误枚举、非法链接、超长文字和不存在的日期", () => {
  const alterations: ((item: Investigation) => void)[] = [
    (item) => { item.mode = "pretend" as never; },
    (item) => { item.sources[0] = "unknown" as never; },
    (item) => { item.steps[0].status = "verified" as never; },
    (item) => { item.evidence[0].relation = "truth" as never; },
    (item) => { item.evidence[0].kind = "ai" as never; },
    (item) => { item.commits[0].type = "remove" as never; },
    (item) => { item.evidence[0].url = "javascript:alert(1)"; },
    (item) => { item.inputUrl = "https://user:secret@example.com"; },
    (item) => { item.title = "长".repeat(501); },
    (item) => { item.createdAt = "2026-02-30T00:00:00Z"; },
    (item) => { item.updatedAt = "昨天"; },
    (item) => { item.commits[0].createdAt = "2026-13-01T00:00:00Z"; },
  ];
  for (const change of alterations) {
    const raw = demo();
    change(raw);
    assert.throws(() => parseBackup([raw]), /档案格式错误/);
  }
});

test("拒绝缺失分支、末端节点、父节点、步骤和证据引用", () => {
  const alterations: ((item: Investigation) => void)[] = [
    (item) => { item.activeBranch = "missing"; },
    (item) => { item.branches[0].head = "missing"; },
    (item) => { item.commits[0].parents = ["missing"]; },
    (item) => { item.commits[0].branch = "missing"; },
    (item) => { item.commits[0].stepId = "missing"; },
    (item) => { item.commits[0].evidenceIds = ["missing"]; },
    (item) => { item.evidence[0].stepId = "missing"; },
  ];
  for (const change of alterations) {
    const raw = demo();
    change(raw);
    assert.throws(() => parseBackup([raw]), /不存在/);
  }
});

test("检查整个提交图的环，含不可从分支末端到达的环", () => {
  const raw = demo();
  raw.commits[0].parents = [raw.commits[raw.commits.length - 1].id];
  assert.throws(() => parseBackup([raw]), /循环引用/);
  const detached = demo();
  detached.commits.push({ ...structuredClone(detached.commits[0]), id: "c-detached", parents: ["c-detached"] });
  assert.throws(() => parseBackup([detached]), /循环引用/);
});

test("迭代处理最大长度提交链，拒绝越界集合和空分支", () => {
  const raw = demo();
  const template = structuredClone(raw.commits[0]);
  raw.commits = Array.from({ length: 1000 }, (_, index) => ({ ...template, id: `c-${index}`, branch: "main", parents: index ? [`c-${index - 1}`] : [] }));
  raw.branches = [{ ...raw.branches[0], head: "c-999" }];
  assert.equal(parseBackup([raw])[0].commits.length, 1000);
  raw.commits.push({ ...template, id: "c-1000", branch: "main", parents: ["c-999"] });
  assert.throws(() => parseBackup([raw]), /数量必须/);
  assert.throws(() => parseBackup(Array.from({ length: 101 }, (_, index) => ({ ...demo(), id: `case-${index}` }))), /数量必须/);
  const emptyBranches = demo();
  emptyBranches.branches = [];
  assert.throws(() => parseBackup([emptyBranches]), /数量必须/);
});
