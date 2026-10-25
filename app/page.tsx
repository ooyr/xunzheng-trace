"use client";
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Undo2, Bell, UserRound, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, CheckCircle2 as CheckCircleIcon, Compass, FileCheck2, FileImage, FileText, FolderOpen, GitBranch, GitCommitHorizontal, GitMerge, ImagePlus, Layers3, Link2 as Link2Icon, ListChecks, Loader2, MessageCircle, MoreHorizontal, Network, PanelLeftClose, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { AccountStatusButton, AccountWorkspace, featureApi, MonitorWorkspace, ScreenshotWorkspace, useAccount } from "@/components/features";
import { api, ChatRoom, ConnectionCard, EmptyState, EvidenceCard, Graph, PageTitle, Report, SourcePicker } from "@/components/workspace";
import { appendCommit, branchCommits, branchEvidence, createDemo, makeReport, safeUrl, shortId, SOURCE_OPTIONS, sourceName, uid } from "@/lib/investigation";
import { parseBackup as validateBackup } from "@/lib/validation";
import { templatePlan } from "@/lib/plan-template";
import { InvestigationAnswer } from "@/components/investigation-answer";
import { NodeEditor } from "@/components/node-editor";
import { ResultTree } from "@/components/result-tree";
import { editNode, deleteNode, previewNodeDeletion } from "@/lib/node-mutations";
import { evidenceFingerprint, saveBranchAnswer } from "@/lib/answers";
import type { BranchAnswer } from "@/lib/types";
import { collectClues, pendingSteps, recoverInterrupted } from "@/lib/collection";
import type { CollectionProgress } from "@/lib/collection";
import type { Evidence, Investigation, PlanResponse, ProviderStatus, SearchResponse, SourceId } from "@/lib/types";

type Nav = "workbench" | "evidence" | "reports" | "chat" | "settings" | "check" | "monitors" | "account";
type Modal = "new" | "sources" | "branch" | "evidence" | "help" | null;
const STORAGE = "trace-investigations-v1";
function parseBackup(value: unknown) { const records = validateBackup(value); if (!records.length) throw new Error("备份里至少需要有一份调查档案。"); return records.map(recoverInterrupted); }
const emptyStatus: ProviderStatus = { model: { configured: false, provider: "TokLens", model: "" }, search: { configured: false, provider: "元宝搜索" }, wechat: { configured: false } };
function download(name: string, value: string, type = "text/markdown;charset=utf-8") { const url = URL.createObjectURL(new Blob([value], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function Home() {
  const { account, loading: accountLoading, error: accountError, refresh: refreshAccount } = useAccount();
  const [unreadMonitors, setUnreadMonitors] = useState(0);
  const [cases, setCasesState] = useState<Investigation[]>([createDemo()]);
  const casesRef = useRef(cases);
  // 自动检索每步立即写入同一份最新状态，避免异步结果覆盖刚完成的收录。
  function setCases(value: Investigation[] | ((previous: Investigation[]) => Investigation[])) {
    const next = typeof value === "function" ? value(casesRef.current) : value;
    casesRef.current = next;
    setCasesState(next);
  }
  const [activeId, setActiveId] = useState("case-demo"); const [selectedId, setSelectedId] = useState("c-7c81e92");
  const [ready, setReady] = useState(false); const [nav, setNav] = useState<Nav>("workbench"); const [tab, setTab] = useState("tree");
  const [modal, setModal] = useState<Modal>(null); const [status, setStatus] = useState<ProviderStatus>(emptyStatus);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(""); const [filter, setFilter] = useState("");
  const [mobileNav, setMobileNav] = useState(false); const [zoom, setZoom] = useState(1); const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [newInput, setNewInput] = useState(""); const [newUrl, setNewUrl] = useState(""); const [inputMode, setInputMode] = useState("text");
  const [nodeAction, setNodeAction] = useState<{ caseId: string; nodeId: string; mode: "edit" | "delete" } | null>(null);
  const [nodeUndo, setNodeUndo] = useState<{ before: Investigation; after: string; selectedId: string } | null>(null);
  const [planError, setPlanError] = useState("");
  const [newSources, setNewSources] = useState<SourceId[]>(["official", "news", "web"]);
  const [image, setImage] = useState<{ name: string; data: string } | null>(null); const [branchName, setBranchName] = useState("");
  const [manual, setManual] = useState({ title: "", url: "", snippet: "", source: "web" as SourceId, relation: "context" as Evidence["relation"] });
  const inputRef = useRef<HTMLTextAreaElement>(null); const fileRef = useRef<HTMLInputElement>(null); const searchLock = useRef(false);
  const planLock = useRef(false); const stopCollectionRef = useRef(false); const activeIdRef = useRef(activeId);
  const [collection, setCollection] = useState<(CollectionProgress & { caseId: string; state: "running" | "stopping" | "finished"; message?: string }) | null>(null);
  activeIdRef.current = activeId;
  const active = cases.find((c) => c.id === activeId) || cases[0];
  const selected = active.commits.find((c) => c.id === selectedId) || active.commits[active.commits.length - 1];
  const currentBranch = active.branches.find((b) => b.id === active.activeBranch)!;
  const evidence = branchEvidence(active); const currentEvidence = active.evidence.filter((e) => selected.evidenceIds.includes(e.id));
  const remainingSteps = pendingSteps(active);
  const collectingHere = !!busy && collection?.caseId === active.id && collection.state !== "finished";
  const hasRealSearch = active.commits.some((commit) => commit.searchMode === "live") || active.evidence.some((entry) => entry.kind === "search");

  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE); if (raw) { try { const saved = parseBackup(JSON.parse(raw)); setCases(saved); setActiveId(saved[0].id); setSelectedId(saved[0].branches.find((b) => b.id === saved[0].activeBranch)!.head); } catch { localStorage.setItem(`${STORAGE}-recovery`, raw); setNotice("本机档案未通过校验，已保留恢复副本并打开示例。"); } } } catch { setNotice("浏览器存储不可用，请用导出功能保存调查。"); }
    setReady(true); refreshStatus();
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(STORAGE, JSON.stringify(cases)); } catch { setNotice("本机存储不可用或空间不足，请导出档案保存。"); } } }, [cases, ready]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !planLock.current) { setModal(null); setNodeAction(null); setMobileNav(false); } if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openNew(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  useEffect(() => {
    let cancelled = false;
    setUnreadMonitors(0);
    if (!account?.user) return;
    const read = async () => { try { const result = await featureApi<{ unreadCount: number }>("/api/monitors"); if (!cancelled) setUnreadMonitors(result.unreadCount); } catch { /* 不打断当前调查，盯梢页会显示具体错误。 */ } };
    void read(); const timer = window.setInterval(read, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [account?.user?.id]);
  function mergeCloudCases(records: Investigation[]) {
    const existing = new Set(casesRef.current.map(item => item.id));
    const added = records.filter(item => !existing.has(item.id)).map(recoverInterrupted);
    if (added.length) setCases(previous => [...added, ...previous]);
    return added.length;
  }
  function advancedActivity(name: "check" | "monitor", working: boolean) { setBusy(working ? name : ""); }
  async function refreshStatus() { try { setStatus(await api<ProviderStatus>("/api/status")); } catch { setNotice("暂时无法读取服务状态，仍可编辑本机档案。"); } }
  function update(id: string, fn: (item: Investigation) => Investigation) { setCases((prev) => prev.map((item) => item.id === id ? fn(item) : item)); }
  function openCase(item: Investigation) { setNodeAction(null); activeIdRef.current = item.id; setActiveId(item.id); setSelectedId(item.branches.find((b) => b.id === item.activeBranch)!.head); setNav("workbench"); setMobileNav(false); setEvidenceFilter("all"); }
  function openNew() { if (busy || searchLock.current || planLock.current) { setNotice("当前正在调查，可先暂停后续检索，再新建问题。"); return; } setNodeAction(null); setPlanError(""); setNewInput(""); setNewUrl(""); setImage(null); setInputMode("text"); setMobileNav(false); setModal("new"); }
  function exportReport(item = active) { download(`循证-${item.title.slice(0, 30)}.md`, makeReport(item)); setNotice("调查报告已导出，包含来源链接与版本记录。"); }
  async function copyReport() { try { await navigator.clipboard.writeText(makeReport(active)); setNotice("报告已复制。"); } catch { exportReport(); } }
  function readImage(file?: File) { if (!file) return; if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setNotice("请上传 JPG、PNG 或 WebP 截图。"); return; } if (file.size > 4 * 1024 * 1024) { setNotice("截图请控制在 4 MB 以内。"); return; } const reader = new FileReader(); reader.onload = () => setImage({ name: file.name, data: String(reader.result) }); reader.onerror = () => setNotice("截图读取失败，请重新选择。"); reader.readAsDataURL(file); }
  async function createCase(automaticallyCollect = true, useRulePlan = false) {
    if (busy || planLock.current || searchLock.current) return;
    if (!useRulePlan && account && !account.user && account.limits.plan.remaining <= 0) { setModal(null); setNav("account"); setNotice("访客今日文字拆解次数已用完，登录后继续调查。"); return; }
    if (!newInput.trim() && !newUrl.trim() && !image) { setNotice("先写下一个问题，或提供链接、截图。"); inputRef.current?.focus(); return; }
    if (newUrl && !safeUrl(newUrl)) { setNotice("请输入完整的 http 或 https 网页链接。"); return; }
    if (!newSources.length) { setNotice("至少选择一个调查来源。"); return; }
    planLock.current = true; setPlanError(""); setBusy("plan");
    let created: Investigation | undefined;
    try {
      const request = { input: newInput.trim(), url: newUrl.trim() || undefined, image: image?.data, sources: newSources };
      // 规则计划由用户明确选择，仅在本机生成，不调用模型或扣除拆解次数。
      const result = useRulePlan ? templatePlan(request) : await api<PlanResponse>("/api/plan", request);
      const at = new Date().toISOString(); const root = uid("c"); const head = uid("c");
      const item: Investigation = { id: uid("case"), title: result.title, input: newInput.trim() || result.extractedText || newUrl || "截图中的待核查说法", inputUrl: newUrl || undefined, imageName: image?.name, createdAt: at, updatedAt: at, sources: newSources, steps: result.steps, evidence: [], commits: [{ id: root, parents: [], branch: "main", title: "收录原始线索", description: newInput || newUrl || image?.name || "截图", type: "init", createdAt: at, evidenceIds: [] }, { id: head, parents: [root], branch: "main", title: `${useRulePlan ? "规则计划：" : "拆解成 "}${result.steps.length} 个调查步骤`, description: result.notice || "调查计划已生成，等待确认并检索。", type: "plan", createdAt: at, evidenceIds: [] }], branches: [{ id: "main", name: "main", head, color: "#258477" }], activeBranch: "main", mode: result.mode };
      if (result.extractedText) item.input = `截图识别原文：${result.extractedText}${newInput.trim() ? `\n补充说明：${newInput.trim()}` : ""}`.slice(0, 12000);
      setCases((prev) => [item, ...prev]); activeIdRef.current = item.id; setActiveId(item.id); setSelectedId(head); setNav("workbench"); setTab("tree"); setModal(null); setMobileNav(false); setImage(null); setNotice(result.notice || "调查计划已生成。");
      created = item;
    } catch (e) { const message = (e as Error).message; setPlanError(message); setNotice(message); } finally { planLock.current = false; setBusy(""); void refreshAccount(); }
    if (created && automaticallyCollect) await startCollection(created);
  }
  async function startCollection(item = active, onlyStep?: string) {
    if (busy || searchLock.current || planLock.current) return;
    if (account && !account.user && account.limits.search.remaining <= 0) { setNav("account"); setNotice("访客今日检索次数已用完，登录后继续调查。"); return; }
    const requestBudget = account?.user ? 6 : Math.min(6, account?.limits.search.remaining ?? 3);
    const id = item.id; const targetBranch = item.activeBranch;
    let shouldSummarize = false;
    const total = onlyStep ? 1 : Math.min(requestBudget, pendingSteps(item, targetBranch).length);
    if (!total) { setNotice("当前分支的计划已检索完成，可以打开原文核验，或新增调查方向。"); return; }
    searchLock.current = true; stopCollectionRef.current = false; setBusy("collect"); setTab("tree");
    setCollection({ caseId: id, state: "running", current: 0, total, stepId: "", title: "准备自动收集线索", added: 0, totalAdded: 0 });
    try {
      const summary = await collectClues({
        read: () => casesRef.current.find((c) => c.id === id)!,
        save: (next) => update(id, () => next),
        search: async (request) => { try { return await api<SearchResponse>("/api/search", request); } finally { void refreshAccount(); } },
        branchId: targetBranch, stepIds: onlyStep ? [onlyStep] : undefined, maxRequests: requestBudget,
        shouldStop: () => stopCollectionRef.current,
        onProgress: (progress) => { setBusy(progress.stepId || "collect"); setCollection({ ...progress, caseId: id, state: stopCollectionRef.current ? "stopping" : "running" }); },
        onCommit: (commitId) => { if (activeIdRef.current === id) setSelectedId(commitId); },
      });
      const message = summary.reason === "error" || summary.reason === "unconfigured" ? summary.message || "检索暂时中断，已收集的线索已保留。" : summary.reason === "stopped" ? `已暂停，完成 ${summary.completed} 步，自动新增 ${summary.added} 条线索。` : summary.reason === "limit" ? `本轮完成 ${summary.completed} 步，自动新增 ${summary.added} 条线索，可继续下一轮。` : `调查完成：执行 ${summary.completed} 步，自动新增 ${summary.added} 条线索。`;
      setCollection({ caseId: id, state: "finished", current: summary.completed, total: summary.total, stepId: "", title: message, added: 0, totalAdded: summary.added, message });
      setNotice(message);
      shouldSummarize = summary.completed > 0;
    } catch (e) { const message = (e as Error).message || "调查暂时中断，已收录内容会保留。"; setNotice(message); setCollection((previous) => previous ? { ...previous, state: "finished", message, title: message } : null); }
    finally { searchLock.current = false; setBusy(""); void refreshAccount(); }
    if (shouldSummarize && account?.user) await generateAnswer(id, targetBranch);
  }
  async function runStep(stepId: string) { await startCollection(active, stepId); }
  function pauseCollection() { stopCollectionRef.current = true; setCollection((value) => value ? { ...value, state: "stopping" } : value); setNotice("当前这步完成后暂停，已收集的线索会保留。"); }
  function createBranch() {
    if (searchLock.current || planLock.current) return;
    const name = branchName.trim(); if (!name) return;
    if (active.branches.some((b) => b.name === name)) { setNotice("这个分支名已经存在，请换一个名称。"); return; }
    const id = uid("branch"); const colors = ["#a28ac7", "#d5975a", "#5b8cc0", "#ca8096"];
    update(active.id, (item) => ({ ...item, activeBranch: id, branches: [...item.branches, { id, name, head: selected.id, color: colors[(item.branches.length - 1) % colors.length] }], updatedAt: new Date().toISOString() }));
    setModal(null); setBranchName(""); setNotice(`已从 ${shortId(selected.id)} 创建「${name}」分支。后续检索会提交到这里。`);
  }
  function mergeBranch() {
    if (searchLock.current || planLock.current) return;
    if (active.activeBranch === "main") return; const branch = currentBranch;
    const mainReachable = new Set(branchCommits(active, "main").map((c) => c.id)); if (mainReachable.has(branch.head)) { setNotice("这个分支的提交已包含在主线中，无需再次合并。"); return; }
    const result = appendCommit({ ...active, activeBranch: "main" }, { title: `合并「${branch.name}」`, description: "保留两个父节点与来源记录。合并记录不会自动裁定主张真伪。", type: "merge", evidenceIds: branchEvidence(active).map((e) => e.id) }, branch.head);
    update(active.id, () => result); setSelectedId(result.branches.find((b) => b.id === "main")!.head); setNotice(`「${branch.name}」已合并到主线，原分支仍可回看。`);
  }
  function addEvidence() {
    if (searchLock.current || planLock.current) { setNotice("当前正在自动收集，暂停后即可手动补充。"); return; }
    const url = safeUrl(manual.url); if (!url || !manual.title.trim() || !manual.snippet.trim()) { setNotice("请填写标题、有效的原文链接和资料摘录。"); return; }
    if (active.evidence.some((e) => e.url === url)) { setNotice("这条来源已经收录，可以在证据库中查看。"); return; }
    const entry: Evidence = { ...manual, title: manual.title.trim(), snippet: manual.snippet.trim(), url, id: uid("e"), kind: "manual", retrievedAt: new Date().toISOString() };
    const result = appendCommit({ ...active, evidence: [...active.evidence, entry] }, { title: `收录：${entry.title}`, description: entry.snippet, type: "evidence", evidenceIds: [entry.id] });
    update(active.id, () => result); setSelectedId(result.branches.find((b) => b.id === result.activeBranch)!.head); setModal(null); setManual({ title: "", url: "", snippet: "", source: "web", relation: "context" }); setNotice("原始资料已收录，并保存为一次调查提交。");
  }
  function changeRelation(entryId: string, relation: Evidence["relation"]) { if (planLock.current) return; update(active.id, (c) => ({ ...c, updatedAt: new Date().toISOString(), evidence: c.evidence.map((e) => e.id === entryId ? { ...e, relation } : e) })); }
  function setCaseSources(sources: SourceId[]) { if (searchLock.current || planLock.current) { setNotice("暂停当前调查后即可调整来源。"); return; } if (!sources.length) { setNotice("至少保留一种调查来源。"); return; } update(active.id, (c) => ({ ...c, sources, updatedAt: new Date().toISOString(), steps: c.steps.map((s) => s.status !== "done" ? { ...s, sources } : s) })); }


  async function generateAnswer(caseId = active.id, branchId = active.activeBranch) {
    if (searchLock.current || planLock.current) return;
    if (!account?.user) { setNav("account"); setNotice("登录后可生成有引用的可能答案；也可以先手工填写暂定结论。"); return; }
    const snapshot = casesRef.current.find(item => item.id === caseId);
    if (!snapshot) return;
    planLock.current = true; setBusy("answer");
    try {
      const result = await api<{ answer: BranchAnswer }>("/api/answer", { investigation: snapshot, branchId });
      const latest = casesRef.current.find(item => item.id === caseId);
      if (!latest) return;
      if (result.answer.branchId !== branchId || result.answer.fingerprint !== evidenceFingerprint(latest, branchId)) { setNotice("资料在整理期间发生变化，请重新生成答案。"); return; }
      update(caseId, item => ({ ...item, answers: [...(item.answers || []).filter(answer => answer.branchId !== branchId), result.answer], updatedAt: new Date().toISOString() }));
      setNotice("可能答案已整理，包含依据、引用和未解问题，请核读原文。");
    } catch (error) { setNotice("资料已保留，答案尚未生成：" + (error as Error).message); }
    finally { planLock.current = false; setBusy(""); }
  }
  function saveAnswer(draft: Pick<BranchAnswer, "answer" | "verdict" | "reason" | "limitations" | "evidenceIds">) {
    if (busy || searchLock.current || planLock.current) throw new Error("请等待当前调查完成后再保存结论。");
    const latest = casesRef.current.find(item => item.id === active.id)!;
    const next = saveBranchAnswer(latest, { ...draft, limitations: draft.limitations.map(line => line.trim()).filter(Boolean) });
    update(active.id, () => next); setNotice("暂定结论已保存到本机档案，引用来源可在报告中打开。");
  }
  function applyNodeAction(draft?: { title: string; note: string }) {
    if (!nodeAction || busy || searchLock.current || planLock.current) throw new Error("请等待当前调查完成。");
    const before = casesRef.current.find(item => item.id === nodeAction.caseId);
    if (!before) throw new Error("调查档案已变化，请重新选择节点。");
    const after = nodeAction.mode === "edit" && draft ? editNode(before, nodeAction.nodeId, draft) : deleteNode(before, nodeAction.nodeId);
    setNodeUndo({ before, after: JSON.stringify(after), selectedId });
    update(before.id, () => after);
    if (!after.commits.some(node => node.id === selectedId)) setSelectedId(after.branches.find(branch => branch.id === after.activeBranch)!.head);
    setNodeAction(null); setNotice(nodeAction.mode === "edit" ? "节点标题与笔记已修改，原始执行记录保留。" : "节点已删除，后续连线已接回父节点，可撤销本次操作。");
  }
  function undoNodeAction() {
    if (!nodeUndo || busy || searchLock.current || planLock.current) return;
    const latest = casesRef.current.find(item => item.id === nodeUndo.before.id);
    if (!latest || JSON.stringify({ ...latest, activeBranch: nodeUndo.before.activeBranch }) !== nodeUndo.after) { setNotice("档案已有后续修改，不能直接撤销以免覆盖新记录；可从导出备份恢复。"); return; }
    const restored = { ...nodeUndo.before, activeBranch: latest.activeBranch };
    update(latest.id, () => restored);
    if (active.id === latest.id) setSelectedId(latest.activeBranch === nodeUndo.before.activeBranch ? nodeUndo.selectedId : restored.branches.find(branch => branch.id === latest.activeBranch)!.head);
    setNodeUndo(null); setNotice("已撤销上次节点操作。");
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
      <a className="brand" href="/" aria-label="循证首页"><span className="brand-symbol"><Network size={23} strokeWidth={1.7} /></span><span>循证 <span className="brand-en">Trace</span></span><span className="beta">BETA</span></a>
      <button className="new-case" disabled={!!busy} onClick={openNew}><Plus size={17} /> 新建调查 <kbd>Ctrl K</kbd></button>
      <div className="nav-label">工作空间 <span>PERSONAL</span></div>
      <nav className="nav-list" aria-label="主导航">{([{ id: "workbench", icon: Compass, name: "调查工作台" }, { id: "evidence", icon: Layers3, name: "证据库" }, { id: "reports", icon: FileText, name: "调查报告" }, { id: "chat", icon: MessageCircle, name: "文字调查室" }, { id: "check", icon: FileImage, name: "截图查证" }, { id: "monitors", icon: Bell, name: "持续盯梢" }, { id: "account", icon: UserRound, name: "账号与云端" }] as const).map((n) => <button key={n.id} disabled={!!busy} className={nav === n.id ? "active" : ""} onClick={() => { setNav(n.id); setMobileNav(false); }}><n.icon size={18} /><span>{n.name}</span>{n.id === "chat" && <span className="tiny-pill">体验</span>}{n.id === "monitors" && unreadMonitors > 0 && <span className="nav-count notification-count">{unreadMonitors}</span>}{n.id === "evidence" && <span className="nav-count">{cases.reduce((sum, c) => sum + c.evidence.length, 0)}</span>}</button>)}</nav>
      <div className="case-label"><span>我的调查 <b>{cases.length.toString().padStart(2, "0")}</b></span><button className="icon-button" onClick={openNew} aria-label="添加调查"><Plus size={15} /></button></div>
      <label className="case-search"><Search size={14} /><input aria-label="查找调查" placeholder="查找调查…" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      <div className="case-list">{cases.filter((item) => item.title.includes(filter)).map((item) => <button className={`case-item ${activeId === item.id ? "selected" : ""}`} disabled={!!busy} key={item.id} onClick={() => openCase(item)}><span className={`case-dot ${item.mode === "demo" ? "demo-dot" : ""}`} /><span>{item.title}<small>{item.id === "case-demo" ? "演示档案" : item.mode === "demo" ? "规则计划" : "调查档案"} · {item.evidence.length} 条资料</small></span></button>)}{!cases.some((i) => i.title.includes(filter)) && <p className="muted empty-search">没有找到相关调查</p>}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-spark"><Sparkles size={17} /></span><strong>少一点猜测，多一份证据。</strong><p>把好奇心，变成有据可查的发现。</p><a href="https://1024.waytoagi.com/tracks/detective" target="_blank" rel="noreferrer">WaytoAGI 侦探赛道 <ArrowUpRight size={13} /></a></div><button disabled={!!busy} className={`settings-link ${nav === "settings" ? "active" : ""}`} onClick={() => { setNav("settings"); setMobileNav(false); }}><Settings2 size={17} /> 接入与设置 <span className={`status-dot ${status.search.configured ? "connected" : ""}`} /></button><div className="profile"><div className="avatar">探</div><div><strong>{account?.user?.username || "访客调查空间"}</strong><small>{account?.user ? "账号高级功能已开放" : "本机档案 · 有限体验"}</small></div><button className="icon-button" aria-label="使用指南" onClick={() => setModal("help")}><CircleHelp size={17} /></button></div></div>
    </aside>
    {mobileNav && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-toggle icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="展开导航"><PanelLeftClose size={18} /></button><FolderOpen size={16} /><span>我的工作空间</span><ChevronRight size={13} /><strong>{{ workbench: "调查工作台", evidence: "证据库", reports: "调查报告", chat: "文字调查室", settings: "接入与设置", check: "截图查证", monitors: "持续盯梢", account: "账号与云端" }[nav]}</strong></div><div className="topbar-actions"><span className="saved-state"><span className="status-dot connected" />{ready ? "档案保存在此浏览器" : "正在读取档案"}</span><button className="icon-button help-button" aria-label="使用指南" onClick={() => setModal("help")}><CircleHelp size={18} /></button><AccountStatusButton account={account} loading={accountLoading} disabled={!!busy} open={() => setNav("account")} /></div></header>
      {!accountLoading && !account?.user && nav !== "account" && <div className="guest-quota-banner"><span>访客今日剩余：拆解 {account?.limits.plan.remaining ?? "—"} 次 · 检索 {account?.limits.search.remaining ?? "—"} 次</span><button disabled={!!busy} onClick={() => setNav("account")}>登录使用高级功能 <ArrowRight size={13} /></button></div>}
      {nav === "workbench" && <div className="workspace page-enter">
        <div className="page-heading"><div><div className="eyebrow"><span className="mini-line" /> INVESTIGATION WORKSPACE <span className="tag">{active.id === "case-demo" ? "示例档案" : active.mode === "demo" ? "规则计划" : "调查档案"}</span></div><h1>{active.title}</h1><p className="heading-description">{active.input}</p><div className="case-metadata"><span><GitBranch size={14} /> {active.branches.length} 个分支</span><i /><span><FileCheck2 size={14} /> {evidence.length} 条资料</span><i /><span><Clock3 size={14} /> {new Date(active.updatedAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}更新</span></div></div><div className="heading-buttons"><button className="button primary" disabled={!!busy || !remainingSteps.length} onClick={() => startCollection()}>{collectingHere ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{collectingHere ? "正在找线索…" : remainingSteps.length ? "一键调查" : "计划已查完"}</button><button className="button export-button" onClick={() => exportReport()}><ArrowDownToLine size={16} /> 导出报告</button></div></div>
        <InvestigationAnswer item={active} busy={!!busy} generating={busy === "answer"} canGenerate={!!account?.user} generate={() => generateAnswer()} save={saveAnswer} login={() => setNav("account")} />
        {nodeUndo?.before.id === active.id && <div className="node-undo-banner"><span>上次节点操作已保存。继续整理前，可以撤销。</span><button className="text-button" disabled={!!busy} onClick={undoNodeAction}><Undo2 size={14} /> 撤销节点操作</button></div>}
        <div className="case-toolbar"><div className="view-tabs" role="tablist" aria-label="调查视图"><button role="tab" aria-selected={tab === "tree"} className={tab === "tree" ? "active" : ""} onClick={() => setTab("tree")}><Layers3 size={16} /> 结果树</button><button role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "active" : ""} onClick={() => setTab("graph")}><Network size={16} /> 调查图谱</button><button role="tab" aria-selected={tab === "timeline"} className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}><GitCommitHorizontal size={17} /> 提交记录 <b>{branchCommits(active).length}</b></button><button role="tab" aria-selected={tab === "report"} className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><FileText size={15} /> 调查报告</button></div><button className="text-button source-toolbar" disabled={!!busy} onClick={() => setModal("sources")}><SlidersHorizontal size={15} /> 来源范围 <span>{active.sources.length}</span></button></div>
        {collection?.caseId === active.id && <section className="collection-banner" aria-live="polite"><div className="collection-banner-copy"><div className="collection-banner-title">{collection.state === "finished" ? <CheckCircleIcon size={17} /> : <Loader2 size={17} className="spin" />}<strong>{collection.state === "stopping" ? "当前这步完成后暂停" : collection.state === "finished" ? collection.message : `正在自动收集线索 · ${collection.current}/${collection.total}`}</strong></div>{collection.state !== "finished" && <p>{collection.title} · 已自动新增 {collection.totalAdded} 条资料</p>}<div className="collection-progress-track" role="progressbar" aria-label="自动调查进度" aria-valuemin={0} aria-valuemax={Math.max(1, collection.total)} aria-valuenow={Math.max(0, collection.current - (collection.phase === "searching" ? 1 : 0))}><span className="collection-progress-fill" style={{ width: `${Math.min(100, (collection.current - (collection.phase === "searching" ? 1 : 0)) / Math.max(1, collection.total) * 100)}%` }} /></div></div><div className="collection-banner-actions">{collection.state === "finished" ? <button className="icon-button" aria-label="关闭调查进度" onClick={() => setCollection(null)}><X size={16} /></button> : <button className="button" disabled={collection.state === "stopping"} onClick={pauseCollection}>{collection.state === "stopping" ? "正在暂停…" : "暂停后续检索"}</button>}</div></section>}<div className="investigation-layout"><section className="investigation-main">
          <div className="graph-panel"><div className="panel-heading"><div className="branch-select-wrap"><GitBranch size={16} /><select aria-label="切换调查分支" value={active.activeBranch} disabled={!!busy} onChange={(e) => { const id = e.target.value; update(active.id, (c) => ({ ...c, activeBranch: id })); setSelectedId(active.branches.find((b) => b.id === id)!.head); }}>{active.branches.map((b) => <option key={b.id} value={b.id}>{b.id === "main" ? "主线" : b.name}</option>)}</select><ChevronDown size={12} /></div><div className="panel-actions">{active.activeBranch !== "main" && <button className="text-button merge-action" disabled={!!busy} onClick={mergeBranch}><GitMerge size={14} /> 合并到主线</button>}<button className="text-button" disabled={!!busy} onClick={() => { setBranchName(""); setModal("branch"); }}><Plus size={14} /> 新建分支</button><button className="icon-button" aria-label="收录证据" disabled={!!busy} onClick={() => setModal("evidence")}><MoreHorizontal size={18} /></button></div></div>
            {tab === "tree" && <ResultTree item={active} selected={selected.id} select={setSelectedId} onOpenReport={() => setTab("report")} />}
            {tab === "graph" && <><div className="graph-caption"><span>每一步发现，都有迹可循</span><span><span className="legend-dot" /> 主线 <span className="legend-dot purple" /> 核验分支</span></div><Graph item={active} selected={selected.id} select={setSelectedId} zoom={zoom} /><div className="graph-footer"><span><span className="status-dot connected" /> {hasRealSearch ? "真实检索已保存 · 来源自动收录" : active.id === "case-demo" ? "预置示例 · 可一键开始真实检索" : active.mode === "demo" ? "规则计划已建档 · 尚未检索" : "点选节点，查看对应资料"}</span><div className="zoom-controls"><button aria-label="缩小图谱" onClick={() => setZoom((z) => Math.max(.65, z - .1))}><ZoomOut size={15} /></button><button onClick={() => setZoom(1)} aria-label="重置图谱缩放">{Math.round(zoom * 100)}%</button><button aria-label="放大图谱" onClick={() => setZoom((z) => Math.min(1.4, z + .1))}><ZoomIn size={15} /></button></div></div></>}
            {tab === "timeline" && <div className="timeline">{branchCommits(active).slice().reverse().map((c) => <button className={`timeline-item ${selected.id === c.id ? "active" : ""}`} key={c.id} onClick={() => setSelectedId(c.id)}><GitCommitHorizontal size={20} /><span><strong>{c.title}</strong><small>{c.description}</small></span><code>{shortId(c.id)}</code></button>)}</div>}
            {tab === "report" && <Report item={active} copy={copyReport} />}
          </div>
          <section className="plan-panel"><div className="section-heading"><div><ListChecks size={18} /><h2>调查计划</h2><span className="count-pill">{active.steps.filter((s) => s.status === "done").length}/{active.steps.length}</span></div><div className="plan-heading-actions"><button className="text-button" disabled={!!busy || !remainingSteps.length} onClick={() => startCollection()}><Sparkles size={14} />{active.evidence.some((e) => e.kind === "search") ? "继续自动调查" : "自动收集线索"}</button></div></div><p className="collection-explainer">{remainingSteps.length ? `检索后自动收录标题、摘要和原文链接，每一步都会保存到图谱。本轮最多 ${Math.min(6, remainingSteps.length)} 次搜索，可暂停后继续。` : "计划已检索完成，线索已自动入库。可以打开来源核验，或从节点创建新的调查方向。"}</p><div className="plan-list">{active.steps.map((step, index) => <div className={`plan-step ${step.status}`} key={step.id}><div className="step-number">{step.status === "done" ? <Check size={14} /> : String(index + 1).padStart(2, "0")}</div><div className="step-content"><strong>{step.title}</strong><p>{step.description}</p><label className="query-editor"><Search size={12} /><input aria-label={`${step.title}查询词`} disabled={!!busy} value={step.query} maxLength={500} onChange={(e) => update(active.id, (c) => ({ ...c, steps: c.steps.map((s) => s.id === step.id ? { ...s, query: e.target.value, status: "pending" } : s) }))} /></label><div className="step-sources">{step.sources.map((id) => <span key={id}>{sourceName(id)}</span>)}</div></div><button aria-label={`${step.status === "done" ? "重新检索" : "检索"}：${step.title}`} className={`step-run ${step.status === "done" ? "completed" : ""}`} disabled={!!busy || !step.query.trim()} onClick={() => runStep(step.id)}>{busy === step.id ? <Loader2 size={14} className="spin" /> : step.status === "done" ? <CheckCheck size={14} /> : <ArrowRight size={14} />}<span>{busy === step.id ? "检索中" : step.status === "done" ? "再检索" : step.status === "blocked" ? "重试" : "检索"}</span></button></div>)}</div></section>
        </section><aside className="evidence-sidebar"><div className="evidence-panel"><div className="section-heading"><div><BookOpen size={17} /><h2>节点证据</h2><span className="count-pill">{currentEvidence.length}</span></div><button className="icon-button" aria-label="手动补充线索" title="手动补充网页来源" disabled={!!busy} onClick={() => setModal("evidence")}><Plus size={16} /></button></div><div className="selected-summary"><span className="selected-label">正在查看 <code>{shortId(selected.id)}</code>{currentBranch.head === selected.id ? " · 当前方向最新进度" : " · 历史节点"}</span><h3>{selected.title}</h3>{selected.note && <p className="node-user-note">{selected.note}</p>}<details className="node-original" open={!selected.note}><summary>{selected.type === "search" ? "原始检索词" : "原始记录"}</summary><p>{selected.description}</p></details><div className="node-action-buttons"><button className="text-button" disabled={!!busy} onClick={() => setNodeAction({ caseId: active.id, nodeId: selected.id, mode: "edit" })}><Pencil size={13} /> 编辑节点</button><button className="text-button node-delete-action" disabled={!!busy || !previewNodeDeletion(active, selected.id).canDelete} title={previewNodeDeletion(active, selected.id).reason || "删除后可撤销，后续节点接回父节点"} onClick={() => setNodeAction({ caseId: active.id, nodeId: selected.id, mode: "delete" })}><Trash2 size={13} /> 删除节点</button></div></div><div className="evidence-list">{currentEvidence.map((entry, i) => <EvidenceCard key={entry.id} entry={entry} index={i} compact changeRelation={(r) => changeRelation(entry.id, r)} />)}{!currentEvidence.length && <div className="empty-evidence"><FileText size={28} strokeWidth={1.2} /><strong>让 AI 自动寻找线索</strong><p>按调查计划搜索公开资料，<br />自动收录来源，无需逐条填写。</p><button className="button primary" disabled={!!busy || !remainingSteps.length} onClick={() => startCollection()}><Sparkles size={14} /> 一键调查</button><button className="text-button manual-add-label" disabled={!!busy} onClick={() => setModal("evidence")}><Plus size={13} /> 手动补充来源</button></div>}</div><button className="view-all" onClick={() => setNav("evidence")}>查看此分支全部资料 <ArrowRight size={14} /></button></div><div className="insight-card"><div className="insight-heading"><ShieldCheck size={18} /><span>调查者笔记</span></div><p>{active.id === "case-demo" ? "“从太空拍到”与“从月球肉眼看到”，是两个需要分别核验的说法。" : "先核查来源与适用条件，再比较证据。检索无结果，也是一条应该保留的调查记录。"}</p><span>保持好奇，也保留怀疑。</span></div><div className="integration-status"><span className={`status-dot ${status.search.configured ? "connected" : ""}`} /><div><strong>元宝搜索{status.search.configured ? "已配置" : "待接入"}</strong><p>{status.search.configured ? "真实查询将通过服务端调用" : "已预留服务端接口，等待密钥"}</p></div><button className="icon-button" aria-label="查看搜索配置" onClick={() => setNav("settings")}><ArrowUpRight size={15} /></button></div></aside></div>
        <footer className="workspace-footer"><span>TRACE THE CLAIM. FOLLOW THE EVIDENCE.</span><span>循证 Trace <span className="footer-dot">·</span> 让结论有迹可循</span></footer>
      </div>}

      {nav === "evidence" && <div className="workspace standalone page-enter"><PageTitle eyebrow="EVIDENCE LIBRARY" title="让证据，彼此对话。" description={`「${active.title}」当前分支的全部资料。请在核对原文后调整证据关系。`} action={<div className="heading-buttons"><button className="button primary" disabled={!!busy || !remainingSteps.length} onClick={() => { setNav("workbench"); startCollection(); }}><Sparkles size={16} /> 自动找线索</button><button className="button" disabled={!!busy} onClick={() => setModal("evidence")}><Plus size={16} /> 手动补充</button></div>} /><div className="library-toolbar"><div className="filter-tabs">{[{ id: "all", name: "全部资料" }, { id: "supports", name: "支持主张" }, { id: "contradicts", name: "反驳主张" }, { id: "context", name: "补充背景" }].map((x) => <button className={evidenceFilter === x.id ? "active" : ""} key={x.id} onClick={() => setEvidenceFilter(x.id)}>{x.name}<span>{evidence.filter((e) => x.id === "all" || e.relation === x.id).length}</span></button>)}</div><span className="muted"><GitBranch size={14} /> {currentBranch.name}</span></div><div className="library-grid">{evidence.filter((e) => evidenceFilter === "all" || e.relation === evidenceFilter).map((entry, i) => <EvidenceCard key={entry.id} entry={entry} index={i} changeRelation={(r) => changeRelation(entry.id, r)} />)}</div>{!evidence.filter((e) => evidenceFilter === "all" || e.relation === evidenceFilter).length && <EmptyState title="还没有这一类资料" description="返回工作台点击一键调查，搜索结果会自动收录到这里。" action={() => { setNav("workbench"); setTab("graph"); }} label="返回调查计划" />}</div>}
      {nav === "reports" && <div className="workspace standalone page-enter"><PageTitle eyebrow="INVESTIGATION REPORTS" title="把调查，变成可回看的报告。" description="报告保留来源、人工标记和版本历史；资料不足时会明确留下未解问题。" /><div className="report-list">{cases.map((item) => <article className="report-list-card" key={item.id}><div className="report-file-icon"><FileText size={25} /></div><div><span className="eyebrow">{item.id === "case-demo" ? "示例档案" : item.mode === "demo" ? "规则计划" : "调查档案"}</span><h2>{item.title}</h2><p>{item.evidence.length} 条资料 · {item.commits.length} 次提交 · {item.branches.length} 个分支</p></div><button className="button" onClick={() => { openCase(item); setTab("report"); }}>查看报告 <ArrowRight size={15} /></button><button className="icon-button" aria-label={`导出${item.title}`} onClick={() => exportReport(item)}><ArrowDownToLine size={18} /></button></article>)}</div></div>}
      {nav === "chat" && <ChatRoom notice={setNotice} onRequestComplete={() => { void refreshAccount(); }} />}
      {nav === "account" && <AccountWorkspace account={account} loading={accountLoading} accountError={accountError} refresh={refreshAccount} cases={cases} mergeCases={mergeCloudCases} locked={!!busy} />}
      {nav === "check" && <ScreenshotWorkspace account={account} onLogin={() => setNav("account")} locked={!!busy} setActivity={working => advancedActivity("check", working)} />}
      {nav === "monitors" && <MonitorWorkspace account={account} onLogin={() => setNav("account")} locked={!!busy} setActivity={working => advancedActivity("monitor", working)} initialCase={active} onUnreadChange={setUnreadMonitors} />}
      {nav === "settings" && <div className="workspace standalone page-enter"><PageTitle eyebrow="CONNECTIONS & SETTINGS" title="好问题，接上好工具。" description="密钥仅从服务端环境变量读取，网页不接收或保存 API 密钥。" action={<button className="button" onClick={refreshStatus}><Settings2 size={15} /> 刷新状态</button>} /><div className="settings-grid"><ConnectionCard icon={<Sparkles size={23} />} name="TokLens · 问题拆解" configured={status.model.configured} description="调用兼容接口生成调查步骤；截图识别需单独配置支持视觉的模型。"><code>TOKLENS_API_KEY</code><code>TOKLENS_BASE_URL</code><code>TOKLENS_MODEL</code><code>TOKLENS_VISION_MODEL（可选）</code><p>当前模型：{status.model.model || "未配置"}</p><a href="https://toklens.ai/zh/manual" target="_blank" rel="noreferrer">查看官方接入手册 <ArrowUpRight size={13} /></a></ConnectionCard><ConnectionCard icon={<Search size={23} />} name="元宝搜索 · 证据发现" configured={status.search.configured} description="按选择的来源查询公开网页，保留原始链接。每次检索只发起一次搜索请求。"><code>YUANBAO_API_KEY（服务 Key 方式）</code><code>TENCENT_SECRET_ID（签名方式）</code><code>TENCENT_SECRET_KEY（签名方式）</code><p>服务 Key 或腾讯云签名密钥任选一种。未配置时不会生成伪造结果。这里显示连接配置，不代表账户额度已验证。</p><a href="https://cloud.tencent.com/document/product/1806/130615" target="_blank" rel="noreferrer">查看 SearchPro 官方说明 <ArrowUpRight size={13} /></a></ConnectionCard><ConnectionCard icon={<MessageCircle size={23} />} name="微信 · 文字调查入口" configured={status.wechat.configured} description="已预留公众号明文回调校验。真实搜索需要补齐会话存储与异步回复。"><code>WECHAT_TOKEN</code><p>回调路径：<b>/api/wechat</b><br />文字调查室可体验编号菜单。私有网页需另配置微信可访问的回调服务。</p><button className="text-button" onClick={() => setNav("chat")}>体验文字调查室 <ArrowRight size={14} /></button></ConnectionCard></div><section className="local-data-card"><div><FolderOpen size={21} /><h2>你的本机档案</h2></div><p>调查记录保存在当前浏览器。截图只在拆解时提交，不写入档案。导出 JSON 可以备份记录，导入时会校验数据结构和节点关系。</p><div className="data-actions"><button className="button" onClick={() => download("循证-调查备份.json", JSON.stringify(cases, null, 2), "application/json;charset=utf-8")}><ArrowDownToLine size={15} /> 导出档案备份</button><label className="button import-button"><Upload size={15} /> 导入档案<input type="file" disabled={!!busy} accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { if (searchLock.current || planLock.current) throw new Error("暂停当前调查后再导入档案。"); if (f.size > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5 MB。"); const data = parseBackup(JSON.parse(await f.text())); setCases((prev) => [...data, ...prev.filter((p) => !data.some((x) => x.id === p.id))]); openCase(data[0]); setNotice("档案已导入，同 ID 档案已替换。"); } catch (err) { setNotice((err as Error).message); } e.target.value = ""; }} /></label></div></section></div>}
    </main>

    {nodeAction && cases.find(item => item.id === nodeAction.caseId) && <NodeEditor key={`${nodeAction.caseId}-${nodeAction.nodeId}-${nodeAction.mode}`} item={cases.find(item => item.id === nodeAction.caseId)!} nodeId={nodeAction.nodeId} mode={nodeAction.mode} busy={!!busy} close={() => setNodeAction(null)} save={draft => applyNodeAction(draft)} remove={() => applyNodeAction()} />}
    {notice && <div className="toast" role="status"><span className="toast-icon"><Compass size={17} /></span><p>{notice}</p><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={16} /></button></div>}
    {modal && <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className={`modal ${modal === "new" ? "new-modal" : ""}`} role="dialog" aria-modal="true" aria-label={{ new: "新建调查", sources: "来源范围", branch: "创建分支", evidence: "收录来源", help: "使用指南" }[modal]}><div className="modal-heading"><div><span className="eyebrow">TRACE YOUR NEXT QUESTION</span><h2>{{ new: "从一个好问题开始。", sources: "这一次，去哪里找证据？", branch: "换个方向，继续求证。", evidence: "把原始资料，放进证据链。", help: "像 Git 一样，展开调查。" }[modal]}</h2></div><button className="icon-button" aria-label="关闭弹窗" disabled={!!busy} onClick={() => setModal(null)}><X size={20} /></button></div>
      {modal === "new" && <><div className="input-tabs">{[{ id: "text", icon: FileText, name: "文字问题" }, { id: "link", icon: Link2Icon, name: "网页链接" }, { id: "image", icon: FileImage, name: "截图查证" }].map((t) => <button key={t.id} className={inputMode === t.id ? "active" : ""} onClick={() => { if (t.id === "image") { setModal(null); setNav("check"); } else setInputMode(t.id); }}><t.icon size={16} />{t.name}</button>)}</div>{inputMode === "link" && <label className="form-field">原始网页链接<input type="url" placeholder="https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} /><small>请在下方补充网页原文或具体说法，当前不自动抓取网页正文。</small></label>}{inputMode === "image" && <div className="image-upload" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readImage(e.dataTransfer.files[0]); }} onPaste={(e) => { const f = Array.from(e.clipboardData.files)[0]; if (f) readImage(f); }} tabIndex={0}>{image ? <div className="image-preview"><img src={image.data} alt="待核查截图预览" /><div><strong>{image.name}</strong><button className="text-button" onClick={() => setImage(null)}>移除截图</button></div></div> : <button onClick={() => fileRef.current?.click()}><ImagePlus size={30} strokeWidth={1.3} /><strong>拖放、粘贴或点击上传截图</strong><span>JPG / PNG / WebP · 最大 4 MB</span></button>}<input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => readImage(e.target.files?.[0])} /><small>视觉模型未接入时，请在下面粘贴截图中的文字。</small></div>}<label className="form-field">{inputMode === "text" ? "想核查什么？" : "需要核查的说法或补充说明"}<textarea autoFocus ref={inputRef} value={newInput} maxLength={12000} rows={4} placeholder="一个听起来很肯定的说法，一条让你存疑的消息，或一个值得查清的问题…" onChange={(e) => setNewInput(e.target.value)} /></label><div className="suggestion-row"><span>试试：</span><button onClick={() => setNewInput("‘长城可以从月球上肉眼看见’是真的吗？请区分肉眼与太空照片。")}>核查公共说法</button><button onClick={() => setNewInput("请核实这次 WaytoAGI 侦探赛道的作品要求、截止时间和评审规则，优先引用官网。")}>核对活动规则</button></div><div className="source-section"><div className="form-label">调查来源 <span>可多选，计划生成后仍可修改</span></div><SourcePicker values={newSources} change={setNewSources} /></div><p className="new-auto-note"><Sparkles size={14} /> 默认自动搜索并收录线索，登录后每轮最多 6 次检索。访客每轮以今日剩余次数为限。保持页面打开，可暂停后续步骤。</p><div className="rule-plan-option"><div><strong>也可以先用规则计划建档</strong><small>不依赖模型，不占拆解次数；建档后可编辑步骤，再按检索额度搜索真实来源。</small></div><button className="button" disabled={!!busy} onClick={() => createCase(false, true)}>用规则计划新建</button></div>{planError && <div className="plan-inline-error" role="alert"><strong>模型计划未能生成</strong><p>{planError}</p><small>输入已保留，可重试或选择上方的规则计划继续。</small></div>}<div className="modal-bottom"><button className="text-button" disabled={!!busy} onClick={() => createCase(false)}>仅生成计划</button><button className="button primary" disabled={!!busy} onClick={() => createCase(true)}>{busy === "plan" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{busy === "plan" ? "正在拆解…" : "拆解并自动调查"}<ArrowRight size={15} /></button></div></>}
      {modal === "sources" && <><p className="modal-description">平台检索覆盖公开且已被索引的页面，不保证能获取站内全部内容。“官方与机构”按服务端列出的机构域名识别。</p><SourcePicker values={active.sources} change={setCaseSources} detailed /><div className="modal-bottom"><span>调整将应用到未完成的调查步骤</span><button className="button primary" disabled={!active.sources.length} onClick={() => setModal(null)}>确认范围 <Check size={16} /></button></div></>}
      {modal === "branch" && <><p className="modal-description">从提交 <code>{shortId(selected.id)}</code> 开始新的调查方向。新证据会留在分支，直到你决定合并。</p><label className="form-field">分支名称<input autoFocus value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={40} onKeyDown={(e) => { if (e.key === "Enter") createBranch(); }} placeholder="例如：核验原始视频、寻找相反证据" /></label><div className="branch-origin"><GitCommitHorizontal size={19} /><strong>{selected.title}</strong><code>{shortId(selected.id)}</code></div><div className="modal-bottom"><span>分支代表待核验的子问题，不是检索平台</span><button className="button primary" onClick={createBranch} disabled={!branchName.trim()}><GitBranch size={16} /> 创建分支</button></div></>}
      {modal === "evidence" && <><p className="modal-description">保留能直接打开的原文。请根据读到的内容，标记它与调查主张的关系。</p><label className="form-field">资料标题<input autoFocus value={manual.title} maxLength={250} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="原始文章或视频标题" /></label><label className="form-field">原始链接<input type="url" value={manual.url} maxLength={2048} onChange={(e) => setManual({ ...manual, url: e.target.value })} placeholder="https://…" /></label><label className="form-field">关键摘录与适用条件<textarea rows={3} maxLength={5000} value={manual.snippet} onChange={(e) => setManual({ ...manual, snippet: e.target.value })} placeholder="哪些内容能支持、反驳或补充这条说法？" /></label><div className="two-fields"><label className="form-field">来源类别<select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value as SourceId })}>{SOURCE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="form-field">证据关系<select value={manual.relation} onChange={(e) => setManual({ ...manual, relation: e.target.value as Evidence["relation"] })}><option value="context">补充背景</option><option value="supports">支持主张</option><option value="contradicts">反驳主张</option></select></label></div><div className="modal-bottom"><span><GitBranch size={14} /> 收录到 {currentBranch.name}</span><button className="button primary" onClick={addEvidence}><Plus size={16} /> 收录并提交</button></div></>}
      {modal === "help" && <><div className="help-steps">{[{ n: "01", title: "把模糊的说法，拆成能查的问题", text: "输入文字、链接或截图，自动生成步骤并收集线索。截图需要支持视觉的模型。" }, { n: "02", title: "选择来源，收集原始资料", text: "一键执行调查计划，自动收录检索得到的原文链接；也能手动补充资料。" }, { n: "03", title: "开一条分支，核查不同解释", text: "点选历史节点创建分支。不同方向的证据可以保留、比较，再合并。" }, { n: "04", title: "把证据和未知，一起写进报告", text: "导出 Markdown 报告或 JSON 档案。没有足够证据时，保留问题。" }].map((s) => <div key={s.n}><span>{s.n}</span><div><h3>{s.title}</h3><p>{s.text}</p></div></div>)}</div><div className="help-note"><ShieldCheck size={18} /> 演示档案仅用于体验。参赛演示需接入元宝并完成 3 次真实查询。请使用公开、非时政、非个人相关的问题。</div><button className="button primary help-close" onClick={() => setModal(null)}>开始循证 <ArrowRight size={16} /></button></>}
    </section></div>}
  </div>;
}

