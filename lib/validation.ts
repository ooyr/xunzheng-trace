import { answerEvidence, evidenceFingerprint } from "./answers";
import type { BranchAnswer, Branch, Commit, Evidence, Investigation, PlanStep, SourceId } from "./types";

type RecordValue = Record<string, unknown>;
type Budget = { characters: number; records: number };

const SOURCES = ["official", "news", "xiaohongshu", "bilibili", "web"] as const;
const STEP_STATUSES = ["pending", "running", "done", "blocked"] as const;
const RELATIONS = ["supports", "contradicts", "context"] as const;
const EVIDENCE_KINDS = ["search", "manual", "demo"] as const;
const COMMIT_TYPES = ["init", "plan", "search", "evidence", "merge"] as const;
const MODES = ["demo", "live"] as const;
const RESERVED_IDS = new Set(["__proto__", "prototype", "constructor"]);

function fail(label: string, message: string): never {
  throw new Error(`档案格式错误：${label}${message}。`);
}

function object(value: unknown, label: string, budget: Budget): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "必须是对象");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(label, "必须是普通数据对象");
  budget.records += 1;
  if (budget.records > 25_000) fail("备份", "包含过多记录，请分批导入");
  return value as RecordValue;
}

// 只读对象自身的数据字段，避免继承字段或访问器混入导入结果。
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) fail(key, "不能使用访问器字段");
  return descriptor.value;
}

function string(value: unknown, label: string, max: number, budget: Budget, required = true): string {
  if (typeof value !== "string") fail(label, "必须是文字");
  if (value.length > max) fail(label, `不能超过 ${max} 个字符`);
  if (required && !value.trim()) fail(label, "不能为空");
  budget.characters += value.length;
  if (budget.characters > 8_000_000) fail("备份", "文字总量过大，请分批导入");
  return value;
}

function optionalString(value: unknown, label: string, max: number, budget: Budget): string | undefined {
  return value === undefined ? undefined : string(value, label, max, budget, false);
}

function id(value: unknown, label: string, budget: Budget): string {
  const parsed = string(value, label, 128, budget);
  if (!/^[\p{L}\p{N}_-]+$/u.test(parsed) || RESERVED_IDS.has(parsed)) fail(label, "含有不支持的标识字符");
  return parsed;
}

function optionalId(value: unknown, label: string, budget: Budget): string | undefined {
  return value === undefined ? undefined : id(value, label, budget);
}

function enumeration<T extends string>(value: unknown, label: string, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(label, "不是支持的选项");
  return value as T;
}

function array<T>(value: unknown, label: string, min: number, max: number, parse: (entry: unknown, label: string) => T): T[] {
  if (!Array.isArray(value)) fail(label, "必须是列表");
  if (value.length < min || value.length > max) fail(label, `数量必须在 ${min} 至 ${max} 之间`);
  const result: T[] = [];
  for (let i = 0; i < value.length; i += 1) result.push(parse(own(value, String(i)), `${label}第 ${i + 1} 项`));
  return result;
}

function unique<T>(values: T[], key: (value: T) => string, label: string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    const entry = key(value);
    if (seen.has(entry)) fail(label, `存在重复标识「${entry}」`);
    seen.add(entry);
  }
  return values;
}

function sources(value: unknown, label: string): SourceId[] {
  return unique(array(value, label, 1, 5, (entry, entryLabel) => enumeration(entry, entryLabel, SOURCES)), (entry) => entry, label);
}

function url(value: unknown, label: string, budget: Budget): string {
  const parsed = string(value, label, 4096, budget);
  try {
    const result = new URL(parsed);
    if (!["https:", "http:"].includes(result.protocol) || result.username || result.password || !result.hostname) fail(label, "必须是不含账号密码的 HTTP 或 HTTPS 链接");
    return result.href;
  } catch {
    fail(label, "必须是不含账号密码的 HTTP 或 HTTPS 链接");
  }
}

function date(value: unknown, label: string, budget: Budget): string {
  const parsed = string(value, label, 40, budget);
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(parsed);
  if (!match || !Number.isFinite(Date.parse(parsed))) fail(label, "必须是包含时区的有效日期时间");
  const calendar = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1]) fail(label, "日期不存在");
  return parsed;
}

function step(value: unknown, label: string, budget: Budget): PlanStep {
  const data = object(value, label, budget);
  return {
    id: id(own(data, "id"), `${label}标识`, budget),
    title: string(own(data, "title"), `${label}标题`, 300, budget),
    description: string(own(data, "description"), `${label}说明`, 10_000, budget, false),
    query: string(own(data, "query"), `${label}查询词`, 3000, budget),
    sources: sources(own(data, "sources"), `${label}来源`),
    status: enumeration(own(data, "status"), `${label}状态`, STEP_STATUSES),
  };
}

function evidence(value: unknown, label: string, budget: Budget): Evidence {
  const data = object(value, label, budget);
  const result: Evidence = {
    id: id(own(data, "id"), `${label}标识`, budget),
    title: string(own(data, "title"), `${label}标题`, 500, budget),
    url: url(own(data, "url"), `${label}链接`, budget),
    snippet: string(own(data, "snippet"), `${label}摘要`, 20_000, budget, false),
    source: enumeration(own(data, "source"), `${label}来源`, SOURCES),
    // 预置示例使用「日期 · 预置示例」，保留原始收录说明。
    retrievedAt: string(own(data, "retrievedAt"), `${label}收录时间`, 120, budget),
    relation: enumeration(own(data, "relation"), `${label}证据关系`, RELATIONS),
    kind: enumeration(own(data, "kind"), `${label}数据类型`, EVIDENCE_KINDS),
  };
  const publishedAt = optionalString(own(data, "publishedAt"), `${label}发布时间`, 120, budget);
  const stepId = optionalId(own(data, "stepId"), `${label}步骤标识`, budget);
  if (publishedAt !== undefined) result.publishedAt = publishedAt;
  if (stepId !== undefined) result.stepId = stepId;
  return result;
}

function commit(value: unknown, label: string, budget: Budget): Commit {
  const data = object(value, label, budget);
  const result: Commit = {
    id: id(own(data, "id"), `${label}标识`, budget),
    parents: unique(array(own(data, "parents"), `${label}父节点`, 0, 8, (entry, entryLabel) => id(entry, entryLabel, budget)), (entry) => entry, `${label}父节点`),
    branch: id(own(data, "branch"), `${label}分支`, budget),
    title: string(own(data, "title"), `${label}标题`, 500, budget),
    description: string(own(data, "description"), `${label}说明`, 10_000, budget, false),
    type: enumeration(own(data, "type"), `${label}类型`, COMMIT_TYPES),
    createdAt: date(own(data, "createdAt"), `${label}创建时间`, budget),
    evidenceIds: unique(array(own(data, "evidenceIds"), `${label}证据引用`, 0, 500, (entry, entryLabel) => id(entry, entryLabel, budget)), (entry) => entry, `${label}证据引用`),
  };
  const stepId = optionalId(own(data, "stepId"), `${label}步骤标识`, budget);
  if (stepId !== undefined) result.stepId = stepId;
  const searchMode = own(data, "searchMode");
  const requestId = own(data, "requestId");
  if (searchMode !== undefined) result.searchMode = enumeration(searchMode, `${label}检索模式`, ["live"] as const);
  if (requestId !== undefined) result.requestId = string(requestId, `${label}请求标识`, 256, budget);
  const note = optionalString(own(data, "note"), `${label}人工笔记`, 5000, budget);
  if (note !== undefined) result.note = note;
  return result;
}

function branch(value: unknown, label: string, budget: Budget): Branch {
  const data = object(value, label, budget);
  const color = string(own(data, "color"), `${label}颜色`, 7, budget);
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) fail(`${label}颜色`, "必须是十六进制颜色");
  return {
    id: id(own(data, "id"), `${label}标识`, budget),
    name: string(own(data, "name"), `${label}名称`, 100, budget),
    head: id(own(data, "head"), `${label}末端节点`, budget),
    color,
  };
}

function answer(value: unknown, label: string, budget: Budget): BranchAnswer {
  const data = object(value, label, budget);
  const fingerprint = string(own(data, "fingerprint"), label + "资料指纹", 100, budget);
  if (!/^a1:[0-9a-f]{16}:\d+$/.test(fingerprint)) fail(label + "资料指纹", "格式不正确");
  const result: BranchAnswer = {
    branchId: id(own(data, "branchId"), label + "分支编号", budget),
    fingerprint,
    answer: string(own(data, "answer"), label + "可能答案", 5000, budget),
    verdict: enumeration(own(data, "verdict"), label + "判断状态", ["supported", "contradicted", "mixed", "insufficient"] as const),
    reason: string(own(data, "reason"), label + "判断依据", 5000, budget),
    limitations: array(own(data, "limitations"), label + "未解问题", 0, 12, (entry, entryLabel) => string(entry, entryLabel, 1000, budget, false)),
    evidenceIds: unique(array(own(data, "evidenceIds"), label + "引用", 0, 40, (entry, entryLabel) => id(entry, entryLabel, budget)), entry => entry, label + "引用"),
    origin: enumeration(own(data, "origin"), label + "来源", ["manual", "model"] as const),
    createdAt: date(own(data, "createdAt"), label + "保存时间", budget),
  };
  if (result.verdict !== "insufficient" && !result.evidenceIds.length) fail(label, "支持、反驳或分歧判断必须有引用");
  return result;
}

function validateReferences(item: Investigation, label: string): void {
  const stepIds = new Set(item.steps.map((entry) => entry.id));
  const evidenceIds = new Set(item.evidence.map((entry) => entry.id));
  const branchIds = new Set(item.branches.map((entry) => entry.id));
  const commits = new Map(item.commits.map((entry) => [entry.id, entry]));
  if (!branchIds.has(item.activeBranch)) fail(`${label}当前分支`, "不存在");
  for (const value of item.answers || []) {
    if (!branchIds.has(value.branchId)) fail(`${label}结论分支`, "不存在");
    if (value.evidenceIds.some(id => !evidenceIds.has(id) || item.evidence.find(entry => entry.id === id)?.kind === "demo")) fail(`${label}结论引用`, "不存在或属于演示资料");
    // 过期答案可以保留历史引用；当前答案必须严格引用本分支可达资料。
    if (value.fingerprint === evidenceFingerprint(item, value.branchId)) {
      const visible = new Set(answerEvidence(item, value.branchId).map(entry => entry.id));
      if (value.evidenceIds.some(id => !visible.has(id))) fail(`${label}结论引用`, "不属于当前分支");
    }
  }
  for (const entry of item.branches) if (!commits.has(entry.head)) fail(`${label}分支「${entry.name}」`, "引用了不存在的末端节点");
  for (const entry of item.evidence) if (entry.stepId !== undefined && !stepIds.has(entry.stepId)) fail(`${label}证据「${entry.title}」`, "引用了不存在的步骤");

  const childIds = new Map<string, string[]>();
  const degrees = new Map<string, number>();
  const pending: string[] = [];
  for (const entry of item.commits) {
    if (!branchIds.has(entry.branch)) fail(`${label}提交「${entry.title}」`, "引用了不存在的分支");
    if (entry.stepId !== undefined && !stepIds.has(entry.stepId)) fail(`${label}提交「${entry.title}」`, "引用了不存在的步骤");
    if (entry.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) fail(`${label}提交「${entry.title}」`, "引用了不存在的证据");
    degrees.set(entry.id, entry.parents.length);
    if (!entry.parents.length) pending.push(entry.id);
    for (const parentId of entry.parents) {
      if (!commits.has(parentId)) fail(`${label}提交「${entry.title}」`, "引用了不存在的父节点");
      const children = childIds.get(parentId) || [];
      children.push(entry.id);
      childIds.set(parentId, children);
    }
  }

  // 使用迭代拓扑检查，环形或深层提交链都不会触发递归栈溢出。
  for (let index = 0; index < pending.length; index += 1) {
    for (const child of childIds.get(pending[index]) || []) {
      const remaining = degrees.get(child)! - 1;
      degrees.set(child, remaining);
      if (remaining === 0) pending.push(child);
    }
  }
  if (pending.length !== item.commits.length) fail(`${label}提交历史`, "包含循环引用");
}

function investigation(value: unknown, label: string, budget: Budget): Investigation {
  const data = object(value, label, budget);
  const result: Investigation = {
    id: id(own(data, "id"), `${label}标识`, budget),
    title: string(own(data, "title"), `${label}标题`, 500, budget),
    input: string(own(data, "input"), `${label}原始问题`, 20_000, budget),
    createdAt: date(own(data, "createdAt"), `${label}创建时间`, budget),
    updatedAt: date(own(data, "updatedAt"), `${label}更新时间`, budget),
    sources: sources(own(data, "sources"), `${label}来源`),
    steps: unique(array(own(data, "steps"), `${label}步骤`, 0, 200, (entry, entryLabel) => step(entry, entryLabel, budget)), (entry) => entry.id, `${label}步骤`),
    evidence: unique(array(own(data, "evidence"), `${label}证据`, 0, 500, (entry, entryLabel) => evidence(entry, entryLabel, budget)), (entry) => entry.id, `${label}证据`),
    commits: unique(array(own(data, "commits"), `${label}提交`, 1, 1000, (entry, entryLabel) => commit(entry, entryLabel, budget)), (entry) => entry.id, `${label}提交`),
    branches: unique(array(own(data, "branches"), `${label}分支`, 1, 100, (entry, entryLabel) => branch(entry, entryLabel, budget)), (entry) => entry.id, `${label}分支`),
    activeBranch: id(own(data, "activeBranch"), `${label}当前分支`, budget),
    mode: enumeration(own(data, "mode"), `${label}模式`, MODES),
  };
  const inputUrl = own(data, "inputUrl");
  if (inputUrl !== undefined) result.inputUrl = url(inputUrl, `${label}输入链接`, budget);
  const imageName = optionalString(own(data, "imageName"), `${label}图片名称`, 255, budget);
  const report = optionalString(own(data, "report"), `${label}报告`, 200_000, budget);
  if (imageName !== undefined) result.imageName = imageName;
  if (report !== undefined) result.report = report;
  const answers = own(data, "answers");
  if (answers !== undefined) result.answers = unique(array(answers, `${label}分支答案`, 0, 100, (entry, entryLabel) => answer(entry, entryLabel, budget)), entry => entry.branchId, `${label}分支答案`);
  if (Date.parse(result.updatedAt) < Date.parse(result.createdAt)) fail(`${label}更新时间`, "不能早于创建时间");
  validateReferences(result, label);
  return result;
}

// 同时兼容浏览器原有列表、单份档案和带 cases 字段的备份包装。
export function parseBackup(value: unknown): Investigation[] {
  const budget: Budget = { characters: 0, records: 0 };
  let entries: unknown = value;
  if (!Array.isArray(value)) {
    const data = object(value, "备份", budget);
    entries = own(data, "cases") === undefined ? [data] : own(data, "cases");
  }
  return unique(array(entries, "调查档案", 0, 100, (entry, label) => investigation(entry, label, budget)), (entry) => entry.id, "调查档案");
}
