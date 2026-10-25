import { getBranchAnswer, isAnswerCurrent, verdictLabel } from "./answers";
import type { Commit, Evidence, Investigation, SourceId } from "./types";

export const SOURCE_OPTIONS: { id: SourceId; name: string; short: string; description: string; color: string }[] = [
  { id: "official", name: "官方与机构", short: "官方", description: "政府、学术机构及精选官网域名", color: "#328570" },
  { id: "news", name: "新闻媒体", short: "媒体", description: "新闻报道与专业媒体", color: "#5b79c2" },
  { id: "xiaohongshu", name: "小红书", short: "小红书", description: "公开且被搜索引擎索引的笔记", color: "#df6b78" },
  { id: "bilibili", name: "哔哩哔哩", short: "B 站", description: "公开且被索引的视频信息", color: "#4e9db8" },
  { id: "web", name: "全网补充", short: "全网", description: "补充其他公开网页来源", color: "#9c83bc" },
];
export const uid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
export const shortId = (id: string) => id.replace(/^[^-]+-/, "").slice(0, 7);
export const sourceName = (id: SourceId) => SOURCE_OPTIONS.find((s) => s.id === id)?.name || "其他网页";
export const relationName = (r: Evidence["relation"]) => ({ supports: "支持主张", contradicts: "反驳主张", context: "补充背景" })[r];
export function safeUrl(value: string): string | null {
  try { const u = new URL(value.trim()); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function hostName(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "来源链接"; } }
// 沿父节点回溯，切换分支时只呈现该分支可到达的调查记录。
export function branchCommits(item: Investigation, branchId = item.activeBranch): Commit[] {
  const branch = item.branches.find((b) => b.id === branchId);
  if (!branch) return [];
  const visited = new Set<string>();
  const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); item.commits.find((c) => c.id === id)?.parents.forEach(visit); };
  visit(branch.head);
  return item.commits.filter((c) => visited.has(c.id));
}
export function branchEvidence(item: Investigation): Evidence[] {
  const ids = new Set(branchCommits(item).flatMap((c) => c.evidenceIds));
  return item.evidence.filter((e) => ids.has(e.id));
}
export function appendCommit(item: Investigation, value: Omit<Commit, "id" | "parents" | "branch" | "createdAt">, extraParent?: string): Investigation {
  const branch = item.branches.find((b) => b.id === item.activeBranch)!;
  const commit: Commit = { ...value, id: uid("c"), parents: [...new Set([branch.head, extraParent].filter(Boolean) as string[])], branch: branch.id, createdAt: new Date().toISOString() };
  return { ...item, commits: [...item.commits, commit], branches: item.branches.map((b) => b.id === branch.id ? { ...b, head: commit.id } : b), updatedAt: commit.createdAt };
}
export function makeReport(item: Investigation): string {
  const savedAnswer = getBranchAnswer(item);
  const currentAnswer = savedAnswer && isAnswerCurrent(item, savedAnswer) ? savedAnswer : undefined;
  const answerLines = currentAnswer ? ["", "## 可能答案与暂定结论", "", `- 判断状态：${verdictLabel(currentAnswer.verdict)}（${currentAnswer.origin === "model" ? "模型整理，待核读" : "人工判断"}）`, "", currentAnswer.answer, "", "### 判断依据", "", currentAnswer.reason, "", ...currentAnswer.evidenceIds.map(id => { const entry = item.evidence.find(value => value.id === id)!; return `- [${entry.title}](${entry.url})`; }), "", "### 未解问题与限制", "", ...currentAnswer.limitations.map(value => `- ${value}`)] : savedAnswer ? ["", "## 可能答案与暂定结论", "", "原有答案依据的调查问题、查询或资料已变化，答案已过期，请重新核验后保存。旧答案不作为当前结论展示。"] : ["", "## 可能答案与暂定结论", "", "尚未整理答案。可以根据当前分支资料生成可能答案，或核读原文后保存人工判断；没有可靠依据时应保留证据不足。"];
  const evidence = branchEvidence(item);
  const branch = item.branches.find((b) => b.id === item.activeBranch)!;
  return [
    `# ${item.title}`, "", `> ${item.id === "case-demo" ? "演示档案：含预置示例或模板步骤，不代表已完成真实 API 查询。" : item.mode === "demo" ? "规则计划档案：仅保存待查步骤，尚未完成真实 API 查询，不能作为事实结论。" : "调查记录：检索摘要仍需对照原始页面核验。"}`,
    "", `- 调查问题：${item.input}`, `- 当前分支：${branch.name}`, `- 生成时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`, `- 来源范围：${item.sources.map(sourceName).join("、")}`,
    "", "## 当前判断", "", evidence.length ? "以下是已收集资料及人工标记。支持或反驳标签表示资料与主张的关系，不等于最终事实裁定；请核对正文、发布日期及适用条件。" : "证据不足。目前没有可引用来源，无法对主张作出判断。",
    ...answerLines,
    "", "## 调查步骤", "", ...item.steps.map((s, i) => `${i + 1}. ${s.title} — ${s.status === "done" ? "已检索，待核读原文" : s.status === "blocked" ? "等待接入或补充资料" : "待执行"}\n   查询词：${s.query}`),
    "", "## 证据与来源", "", ...evidence.map((e, i) => `### [${i + 1}] ${e.title}\n\n- 原文：${e.url}\n- 来源类别：${sourceName(e.source)}\n- 关系标记：${relationName(e.relation)}\n- 收录时间：${e.retrievedAt}${e.publishedAt ? `\n- 发布日期：${e.publishedAt}` : ""}\n- 数据类型：${e.kind === "demo" ? "预置演示资料" : e.kind === "manual" ? "人工添加" : "搜索接口返回"}\n\n${e.snippet}\n`),
    "## 调查版本", "", ...branchCommits(item).map((c) => `- \`${shortId(c.id)}\` ${c.title}（父节点：${c.parents.map(shortId).join(", ") || "无"}）${c.note ? `\n  人工笔记：${c.note}` : ""}`),
    "", "## 未解决的问题", "", "- 搜索摘要可能遗漏上下文，需打开原文核对。", "- 多篇转载不等于多个独立证据。", "- 未被索引、登录后可见或已删除的内容可能无法检索。", "- 尚未完成的步骤与相反证据需要继续核查。", "", "由 循证 Trace 导出 · 让结论有迹可循。",
  ].join("\n");
}
export function createDemo(): Investigation {
  const at = "2026-10-24T09:00:00+08:00";
  return {
    id: "case-demo", title: "从月球上，真的能肉眼看见长城吗？", input: "有人说：长城是唯一能从月球上肉眼看见的人造建筑。这是真的吗？太空照片能证明吗？", createdAt: at, updatedAt: at, sources: ["official", "news", "bilibili"], activeBranch: "main", mode: "demo",
    steps: [
      { id: "step-1", title: "拆开说法中的三个条件", description: "分别核验观察地点、是否借助镜头，以及“唯一”的范围。", query: "长城 月球 肉眼 太空照片 观察条件", sources: ["official"], status: "done" },
      { id: "step-2", title: "寻找航天机构的一手资料", description: "优先查找 NASA、ESA 的原始说明，区分月球与近地轨道。", query: "Great Wall visible Moon naked eye site:nasa.gov", sources: ["official"], status: "done" },
      { id: "step-3", title: "交叉核验照片的拍摄条件", description: "检查相机、拍摄位置与原始语境，避免用照片代替肉眼观察。", query: "Great Wall astronaut photograph camera site:esa.int", sources: ["official", "bilibili"], status: "done" },
      { id: "step-4", title: "补充独立来源并记录不确定性", description: "继续寻找独立公开资料，标记仍无法确认的细节。", query: "长城 从月球 肉眼 可见 科普 核实", sources: ["official", "news"], status: "pending" },
    ],
    evidence: [
      { id: "e-nasa", title: "NASA：长城在太空中的可见性", url: "https://www.nasa.gov/wp-content/uploads/static/history/PDFs/great_wall_less_great_from_space.pdf", snippet: "NASA 的资料明确否定从月球上看见长城的说法，并说明近地轨道照片的拍摄条件与肉眼观察不同。", source: "official", publishedAt: "2005-05-09", retrievedAt: "2026-10-24 · 预置示例", relation: "contradicts", stepId: "step-2", kind: "demo" },
      { id: "e-esa", title: "ESA：宇航员如何观察地面建筑", url: "https://blogs.esa.int/exploration/askmatthias-orbit-edition/", snippet: "ESA 的问答谈及从空间站寻找长城，以及同事拍摄照片的经历。它提供了观察条件的背景，不能直接证明月球上的肉眼观察。", source: "official", retrievedAt: "2026-10-24 · 预置示例", relation: "context", stepId: "step-3", kind: "demo" },
      { id: "e-orbit", title: "NASA：月球与空间站观察距离的差别", url: "https://science.nasa.gov/earth/earth-observatory/the-rocky-mountain-trench-84881/", snippet: "这篇关于地表地貌的说明对比了月球与空间站的观察距离。用它帮助理解“太空中可见”需要说明具体位置。", source: "official", publishedAt: "2014-12-13", retrievedAt: "2026-10-24 · 预置示例", relation: "context", stepId: "step-3", kind: "demo" },
    ],
    branches: [{ id: "main", name: "main", head: "c-7c81e92", color: "#258477" }, { id: "branch-photo", name: "核验观察条件", head: "c-29e1f05", color: "#a28ac7" }],
    commits: [
      { id: "c-a31d9e2", parents: [], branch: "main", title: "收录原始说法", description: "长城是唯一能从月球上肉眼看见的人造建筑？", type: "init", createdAt: at, evidenceIds: [] },
      { id: "c-b81f0a4", parents: ["c-a31d9e2"], branch: "main", title: "拆解成 4 个调查步骤", description: "先定义主张，再寻找原始资料与反例。", type: "plan", createdAt: at, evidenceIds: [], stepId: "step-1" },
      { id: "c-19a3b72", parents: ["c-b81f0a4"], branch: "main", title: "找到 NASA 的原始说明", description: "已收录一条直接回应核心主张的资料。", type: "search", createdAt: at, evidenceIds: ["e-nasa"], stepId: "step-2" },
      { id: "c-93d2b18", parents: ["c-b81f0a4"], branch: "branch-photo", title: "照片 ≠ 肉眼观察", description: "新分支：检查照片实际证明了什么。", type: "search", createdAt: at, evidenceIds: ["e-esa"], stepId: "step-3" },
      { id: "c-29e1f05", parents: ["c-93d2b18"], branch: "branch-photo", title: "补充观察距离的背景", description: "月球与近地轨道不能混为一谈。", type: "evidence", createdAt: at, evidenceIds: ["e-orbit"] },
      { id: "c-7c81e92", parents: ["c-19a3b72", "c-29e1f05"], branch: "main", title: "合并证据，保留核验过程", description: "3 条资料已汇合，仍可继续补充与修正。", type: "merge", createdAt: at, evidenceIds: ["e-nasa", "e-esa", "e-orbit"] },
    ],
  };
}
