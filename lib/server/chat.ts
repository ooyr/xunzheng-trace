import type { Evidence, PlanStep, SourceId } from "../types";
import { ApiError, publicHttpUrl, textField } from "./http";
import { createPlan, validatePlan } from "./planner";
import { runSearch } from "./search";
import { parseSources, SOURCE_LABELS } from "./sources";

export interface ChatSession { question?: string; sources?: SourceId[]; steps?: PlanStep[]; cursor?: number; evidence?: Evidence[]; }
export interface ChatResult { reply: string; session: ChatSession; mode: "demo" | "live" | "unconfigured"; }
export const CHAT_MENU = "欢迎来到循证调查局。\n\n发送「新建 你想核查的说法」开启调查。\n来源：1 官方与学术 / 2 新闻媒体 / 3 小红书 / 4 B站 / 5 全网\n发送「来源 1,2」切换范围。\n发送「下一步」逐步检索，发送「报告」查看证据。\n\n这是网页文字冒险模拟器；真实微信公众号消息尚未接入。";

function parseSession(raw: unknown): ChatSession {
  if (raw === undefined || raw === null) return { sources: ["official", "news"], cursor: 0, evidence: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "会话结构不正确。", "INVALID_SESSION");
  const value = raw as Record<string, unknown>;
  const question = textField(value.question, "会话问题", 12000);
  const sources = value.sources === undefined ? ["official", "news"] as SourceId[] : parseSources(value.sources);
  const cursor = typeof value.cursor === "number" && Number.isInteger(value.cursor) && value.cursor >= 0 && value.cursor <= 6 ? value.cursor : 0;
  let steps: PlanStep[] = [];
  if (value.steps !== undefined) {
    if (!Array.isArray(value.steps) || value.steps.length > 6) throw new ApiError(400, "会话步骤不正确。", "INVALID_SESSION");
    steps = value.steps.map((rawStep, index) => {
      if (!rawStep || typeof rawStep !== "object") throw new ApiError(400, "会话步骤不正确。", "INVALID_SESSION");
      const item = rawStep as Record<string, unknown>;
      return { id: textField(item.id, "步骤编号", 100) || `step-${index + 1}`, title: textField(item.title, "步骤标题", 100, true), description: textField(item.description, "步骤说明", 1200, true), query: textField(item.query, "检索词", 1000, true), sources, status: item.status === "done" ? "done" as const : "pending" as const };
    });
  }
  let evidence: Evidence[] = [];
  if (value.evidence !== undefined) {
    if (!Array.isArray(value.evidence) || value.evidence.length > 60) throw new ApiError(400, "会话证据过多，请新建调查。", "INVALID_SESSION");
    evidence = value.evidence.map((rawEvidence, index) => {
      if (!rawEvidence || typeof rawEvidence !== "object") throw new ApiError(400, "会话证据结构不正确。", "INVALID_SESSION");
      const item = rawEvidence as Record<string, unknown>;
      const url = publicHttpUrl(textField(item.url, "证据链接", 4096, true));
      if (!url) throw new ApiError(400, "会话中包含无效的证据链接。", "INVALID_SESSION");
      return { id: textField(item.id, "证据编号", 100) || `session-${index}`, title: textField(item.title, "证据标题", 300, true), url, snippet: textField(item.snippet, "证据摘录", 3000), source: parseSources([item.source])[0], retrievedAt: textField(item.retrievedAt, "检索时间", 100) || new Date().toISOString(), relation: "context" as const, kind: "manual" as const, stepId: textField(item.stepId, "证据步骤", 100) || undefined };
    });
  }
  return { question: question || undefined, sources, steps, cursor, evidence };
}

export async function chatCommand(raw: Record<string, unknown>): Promise<ChatResult> {
  const message = textField(raw.message, "消息", 12000, true);
  const session = parseSession(raw.session);
  if (["帮助", "菜单", "开始", "help", "/start"].includes(message.toLowerCase())) return { reply: CHAT_MENU, session, mode: "demo" };
  const choice = message.match(/^(?:来源\s*)?([1-5](?:[,，、\s]+[1-5])*)(?:\s*(?:官方|新闻|小红书|B站|全网))?$/i);
  if (choice) {
    const mapping: SourceId[] = ["official", "news", "xiaohongshu", "bilibili", "web"];
    const sources = [...new Set(choice[1].match(/[1-5]/g)?.map(digit => mapping[Number(digit) - 1]))];
    session.sources = sources;
    session.steps = session.steps?.map(step => ({ ...step, sources }));
    return { reply: `搜索范围已改为：${sources.map(item => SOURCE_LABELS[item]).join("、")}。\n${session.question ? "发送「下一步」执行下一项调查。" : "发送「新建 问题」开始。"}`, session, mode: "demo" };
  }
  if (/^(新建|调查)\s*/.test(message) || !session.question && !["报告", "下一步", "检索"].includes(message)) {
    const question = message.replace(/^(新建|调查)\s*/, "").trim();
    const plan = await createPlan(validatePlan({ input: question, sources: session.sources }));
    const nextSession: ChatSession = { question, sources: session.sources, steps: plan.steps, cursor: 0, evidence: [] };
    return { reply: `调查已建立：${plan.title}\n\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n")}\n\n${plan.notice || "计划已生成。"}\n\n发送「来源 1,2」选择范围，再发「下一步」检索。`, session: nextSession, mode: plan.mode };
  }
  if (message === "报告") {
    if (!session.question) return { reply: "还没有调查。发送「新建 你想核查的说法」开始。", session, mode: "demo" };
    const evidence = session.evidence || [];
    return { reply: `调查记录：${session.question}\n已执行 ${session.cursor || 0}/${session.steps?.length || 0} 步，保存 ${evidence.length} 条线索。\n\n${evidence.length ? evidence.slice(0, 12).map((item, index) => `[${index + 1}] ${item.title}\n${item.snippet.slice(0, 180)}\n${item.url}`).join("\n\n") : "暂无线索，无法判断原说法真假。"}\n\n结论状态：待核验。搜索摘要和客户端保存的记录未经独立审阅；请打开来源核对原文。`, session, mode: "demo" };
  }
  if (["下一步", "检索", "继续"].includes(message)) {
    const cursor = session.cursor || 0;
    const step = session.steps?.[cursor];
    if (!step) return { reply: session.question ? "当前计划已执行完毕。发送「报告」查看证据记录；仍需核对原文再下结论。" : "请先发送「新建 你想核查的说法」。", session, mode: "demo" };
    const result = await runSearch({ query: step.query, sources: session.sources || ["official", "news"], stepId: step.id, limit: 6 });
    if (result.mode === "unconfigured") return { reply: `${step.title}\n检索词：${step.query}\n\n${result.notice}\n可先回到网页手动添加来源。`, session, mode: "unconfigured" };
    const oldEvidence = session.evidence || [];
    session.evidence = [...oldEvidence, ...result.results.filter(item => !oldEvidence.some(existing => existing.url === item.url))].slice(0, 60);
    session.cursor = cursor + 1;
    session.steps = session.steps?.map((item, index) => index === cursor ? { ...item, status: "done" } : item);
    return { reply: `${step.title}：找到 ${result.results.length} 条符合范围的线索。\n\n${result.results.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`).join("\n\n")}\n\n${result.notice}\n\n发送「下一步」继续，或「报告」查看记录。`, session, mode: "live" };
  }
  return { reply: "可发送「下一步」「来源 1,2」「报告」，或「新建 新问题」。发送「帮助」查看玩法。", session, mode: "demo" };
}
