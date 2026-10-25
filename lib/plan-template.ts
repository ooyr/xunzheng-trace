import type { PlanRequest, PlanResponse } from "./types";

export function templatePlan(request: PlanRequest, extraNotice = ""): PlanResponse {
  const subject = (request.input || request.url || "截图中的说法（待补充原文）").replace(/\s+/g, " ").slice(0, 100);
  const definitions = [
    ["还原原始说法", "确认原文、发布者、时间和上下文，避免把转述当作原始信息。", `${subject} 原始出处 发布时间`],
    ["寻找一手证据", "搜索官方声明、原始研究或直接记录，逐条保存可打开的来源。", `${subject} 官方 原始资料`],
    ["交叉核验与反证", "比较独立来源，主动查找相反证据，区分不同适用条件。", `${subject} 核实 反证 不同条件`],
    ["整理证据与未解问题", "对照原始问题整理证据链；没有证据支持的部分明确保留为待查。", `${subject} 证据局限 最新进展`],
  ];
  return { title: subject.slice(0, 60), mode: "demo", steps: definitions.map(([title, description, query], index) => ({ id: `step-${index + 1}`, title, description, query: query.slice(0, 500), sources: request.sources, status: "pending" })), notice: ["当前使用规则模板拆解，尚未调用模型，也未进行搜索。", request.url ? "目前不会自动抓取网页正文，请粘贴待核查的原文。" : "", request.image ? "截图尚未识别，请配置支持图片输入的视觉模型或补充截图原文。" : "", extraNotice].filter(Boolean).join(" ") };
}
