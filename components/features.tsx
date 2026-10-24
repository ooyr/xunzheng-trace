"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, Cloud, FileImage, ImagePlus, Loader2, LogIn, LogOut, Pause, Play, RefreshCw, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { PageTitle, SourcePicker } from "./workspace";
import { safeUrl, sourceName } from "@/lib/investigation";
import { parseBackup } from "@/lib/validation";
import type { AccountStatus, MonitorJob, MonitorRun } from "@/lib/account-types";
import type { CheckResponse } from "@/lib/check-types";
import type { Investigation, SourceId } from "@/lib/types";

export async function featureApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", credentials: "same-origin", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as T & { error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : data?.error?.message || "请求没有完成，请稍后重试。");
  return data;
}

export function useAccount() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function refresh() {
    const version = ++request.current;
    try { const next = await featureApi<AccountStatus>("/api/auth/me"); if (version === request.current) { setAccount(next); setError(""); } }
    catch (problem) { if (version === request.current) setError((problem as Error).message); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return { account, loading, error, refresh };
}

function saveFile(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function time(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未复查"; }
function errorText(problem: unknown) { return problem instanceof Error ? problem.message : "操作没有完成，请稍后重试。"; }

export function AccountStatusButton({ account, loading, disabled, open }: { account: AccountStatus | null; loading: boolean; disabled: boolean; open: () => void }) {
  return <button className="account-status-button" disabled={disabled} onClick={open} aria-label={account?.user ? `账号：${account.user.username}` : "登录或注册"}>
    <UserRound size={15} /><span>{loading ? "读取账号…" : account?.user?.username || "登录 / 注册"}</span>
  </button>;
}

function LoginGate({ title, description, onLogin }: { title: string; description: string; onLogin: () => void }) {
  return <section className="feature-login-gate"><ShieldCheck size={32} /><h2>{title}</h2><p>{description}</p><button className="button primary" onClick={onLogin}><LogIn size={15} /> 登录或注册账号</button><small>访客仍可在调查工作台体验文字拆解与公开检索。</small></section>;
}

export function AccountWorkspace({ account, loading, accountError, refresh, cases, mergeCases, locked }: { account: AccountStatus | null; loading: boolean; accountError: string; refresh: () => Promise<void>; cases: Investigation[]; mergeCases: (value: Investigation[]) => number; locked: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [working, setWorking] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [cloudCount, setCloudCount] = useState<number | null>(null); const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | undefined>();
  const identity = account?.user?.id;
  useEffect(() => { setMessage(""); setError(""); setCloudCount(null); setCloudUpdatedAt(undefined); setPassword(""); }, [identity]);
  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); if (working || locked) return;
    setWorking(mode); setError(""); setMessage("");
    try { await featureApi(`/api/auth/${mode}`, "POST", { username: username.trim(), password }); setPassword(""); await refresh(); setMessage(mode === "register" ? "账号已创建并登录，高级功能已开放。" : "登录成功，高级功能已开放。"); }
    catch (problem) { setError(errorText(problem)); } finally { setWorking(""); }
  }
  async function logout() {
    if (working || locked) return; setWorking("logout"); setError("");
    try { await featureApi("/api/auth/logout", "POST", {}); await refresh(); setMessage("已退出账号，本机调查档案仍保存在这个浏览器。"); }
    catch (problem) { setError(errorText(problem)); } finally { setWorking(""); }
  }
  async function cloud(action: "save" | "load") {
    if (working || locked) return; setWorking(action); setError(""); setMessage("");
    try {
      const stored = await featureApi<{ cases: Investigation[]; updatedAt?: string }>("/api/cloud-cases");
      const validated = parseBackup(stored.cases);
      if (action === "save") {
        // 保留云端其它档案，只在用户明确保存时更新同 ID 的本机版本。
        const localIds = new Set(cases.map(item => item.id));
        const combined = [...cases, ...validated.filter(item => !localIds.has(item.id))];
        if (combined.length > 50) throw new Error("合并后超过 50 份档案，请先导出并整理后再保存。");
        const result = await featureApi<{ saved: number; updatedAt: string }>("/api/cloud-cases", "PUT", { cases: combined });
        setCloudCount(result.saved); setCloudUpdatedAt(result.updatedAt); setMessage(`已保存 ${result.saved} 份档案到当前账号。`);
      } else {
        const count = mergeCases(validated); setCloudCount(validated.length); setCloudUpdatedAt(stored.updatedAt);
        setMessage(`已从当前账号取回 ${count} 份新档案。同 ID 的本机档案保持现有版本。`);
      }
    } catch (problem) { setError(errorText(problem)); } finally { setWorking(""); }
  }
  return <div className="workspace standalone page-enter feature-workspace">
    <PageTitle eyebrow="ACCOUNT & CLOUD" title="账号与云端档案" description="使用循证自己的账号密码登录。访客可以直接体验，登录后开放截图查证、云端保存和后台盯梢。" />
    {(error || accountError) && <p className="feature-message error" role="alert">{error || accountError}</p>}
    {message && <p className="feature-message success" role="status">{message}</p>}
    {loading ? <div className="feature-loading"><Loader2 className="spin" size={20} /> 正在读取账号状态…</div> : !account?.user ? <div className="account-layout">
      <section className="feature-panel account-form-panel"><div className="feature-tabs" role="tablist" aria-label="账号方式"><button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} disabled={!!working} onClick={() => { setMode("login"); setError(""); }}>账号登录</button><button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} disabled={!!working} onClick={() => { setMode("register"); setError(""); }}>注册账号</button></div>
        <form onSubmit={authenticate}><label className="form-field">用户名<input name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" required disabled={!!working || locked} placeholder="3–32 位英文字母、数字、下划线或短横线" /></label><label className="form-field">密码<input name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} required disabled={!!working || locked} placeholder="至少 10 个字符" /></label><button className="button primary full-width" type="submit" disabled={!!working || locked || !account?.storageConfigured}>{working ? <Loader2 className="spin" size={16} /> : <LogIn size={16} />}{working ? "正在处理…" : mode === "login" ? "登录并使用高级功能" : "创建账号并登录"}</button></form>
        {account && !account.storageConfigured && <p className="feature-footnote">账号存储尚未连接，请稍后重试。</p>}
      </section>
      <section className="feature-panel entitlement-panel"><h2>访客今日体验</h2><div className="quota-row"><span>文字拆解</span><strong>{account?.limits.plan.remaining ?? "—"} / {account?.limits.plan.limit ?? 2} 次剩余</strong></div><div className="quota-row"><span>元宝检索</span><strong>{account?.limits.search.remaining ?? "—"} / {account?.limits.search.limit ?? 3} 次剩余</strong></div><p>访客次数由服务端按当日请求记录。登录后可继续调查，并使用全部高级功能。</p><h3>账号开放的功能</h3><ul><li>截图识别后逐条核对主张</li><li>云端保存与取回调查档案</li><li>持续盯梢、历史差异与站内提醒</li></ul><p className="feature-footnote">登录不会自动上传本机档案。你可以在登录后自行选择保存。</p></section>
    </div> : <div className="account-layout"><section className="feature-panel"><div className="feature-section-heading"><div><span className="feature-eyebrow">当前账号</span><h2>{account.user.username}</h2></div><UserRound size={27} /></div><p>高级功能已开放。账号创建于 {time(account.user.createdAt)}。</p><button className="button" disabled={!!working || locked} onClick={logout}>{working === "logout" ? <Loader2 className="spin" size={15} /> : <LogOut size={15} />} 退出当前账号</button><p className="feature-footnote">本机档案保存在当前浏览器。切换账号不会自动同步或合并云端内容。</p></section>
      <section className="feature-panel"><div className="feature-section-heading"><h2>云端档案备份</h2><Cloud size={25} /></div><p>当前浏览器有 {cases.length} 份调查档案{cloudCount !== null ? `，当前账号云端有 ${cloudCount} 份` : ""}。</p><div className="feature-actions"><button className="button primary" disabled={!!working || locked} onClick={() => cloud("save")}>{working === "save" ? <Loader2 className="spin" size={15} /> : <Cloud size={15} />} 保存本机档案到账号</button><button className="button" disabled={!!working || locked} onClick={() => cloud("load")}>{working === "load" ? <Loader2 className="spin" size={15} /> : <ArrowDownToLine size={15} />} 取回云端档案</button></div><p className="feature-footnote">保存时更新同 ID 的云端档案并保留其它云端记录；取回时只添加本机尚无的档案。</p>{cloudUpdatedAt && <p className="feature-footnote">云端更新时间：{time(cloudUpdatedAt)}（北京时间）</p>}</section></div>}
  </div>;
}

function checkReport(result: CheckResponse) {
  const verdict = { supported: "检索资料支持", refuted: "检索资料反驳", insufficient: "证据不足" };
  return [`# 截图查证记录`, `\n核对时间：${time(result.createdAt)}（北京时间）`, `\n处理状态：${result.status === "complete" ? "完成本轮核对" : "部分完成，仍有未知"}`, `\n## 识别原文\n${result.extractedText}`, "\n## 逐条核对", ...result.results.map(item => `\n### ${item.claim}\n\n初步判断：${verdict[item.verdict]}\n\n${item.explanation}\n\n${item.evidenceIds.map(id => { const entry = result.evidence.find(e => e.id === id); return entry ? `- [${entry.title}](${entry.url})` : ""; }).filter(Boolean).join("\n")}`), `\n## 本轮来源\n${result.evidence.map(e => `- [${e.title}](${e.url})`).join("\n")}`, `\n## 适用范围\n${result.limitations.map(text => `- ${text}`).join("\n")}`, `\nSearchPro 请求编号：${result.requestIds.join("、") || "无有效编号"}`, `\n实际发起检索请求：${result.usedSearches} 次。请求数不等于账单确认用量。`].join("\n");
}

export function ScreenshotWorkspace({ account, onLogin, locked, setActivity }: { account: AccountStatus | null; onLogin: () => void; locked: boolean; setActivity: (active: boolean) => void }) {
  const [image, setImage] = useState<{ name: string; data: string } | null>(null); const [input, setInput] = useState("");
  const [sources, setSources] = useState<SourceId[]>(["official", "news", "web"]); const [working, setWorking] = useState(false);
  const [error, setError] = useState(""); const [result, setResult] = useState<CheckResponse | null>(null); const file = useRef<HTMLInputElement>(null);
  const userId = account?.user?.id;
  useEffect(() => { setImage(null); setInput(""); setResult(null); setError(""); }, [userId]);
  function readImage(value?: File) {
    if (!value || working || locked) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(value.type)) { setError("请上传 JPG、PNG 或 WebP 截图。"); return; }
    if (value.size > 5 * 1024 * 1024) { setError("截图不能超过 5 MB。"); return; }
    const reader = new FileReader(); reader.onload = () => { setImage({ name: value.name, data: String(reader.result) }); setError(""); }; reader.onerror = () => setError("无法读取这张截图，请重新选择。"); reader.readAsDataURL(value);
  }
  async function verify() {
    if (!image || working || locked) return;
    if (!sources.length) { setError("至少选择一种检索来源。"); return; }
    setWorking(true); setActivity(true); setError(""); setResult(null);
    try { const checked = await featureApi<CheckResponse>("/api/check", "POST", { image: image.data, input: input.trim(), sources }); setResult(checked); }
    catch (problem) { setError(errorText(problem)); }
    finally { setWorking(false); setActivity(false); }
  }
  return <div className="workspace standalone page-enter feature-workspace"><PageTitle eyebrow="SCREENSHOT CHECK" title="截图里的说法，逐条查清" description="读取截图中的文字或明确主张，再用元宝搜索核对公开资料。核对结果保留原始来源与未知。" />
    {!account?.user ? <LoginGate title="登录后使用截图查证" description="账号开放图片识别、逐条检索和核对报告。截图只在本轮处理时发送给所配置的视觉模型。" onLogin={onLogin} /> : <>
      <div className="screenshot-layout"><section className="feature-panel screenshot-input-panel"><h2>提供待查证的截图</h2><div className={`feature-image-drop ${image ? "has-image" : ""}`} tabIndex={0} aria-label="截图拖放或粘贴区域" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); readImage(event.dataTransfer.files[0]); }} onPaste={event => { const value = Array.from(event.clipboardData.items).find(item => item.type.startsWith("image/"))?.getAsFile(); if (value) { event.preventDefault(); readImage(value); } }}>
        <input ref={file} type="file" aria-label="上传待查证截图" accept="image/png,image/jpeg,image/webp" disabled={working || locked} onChange={event => { readImage(event.target.files?.[0]); event.target.value = ""; }} />
        {image ? <><img src={image.data} alt="本轮待查证截图预览" /><strong>{image.name}</strong><button className="text-button" disabled={working || locked} onClick={() => setImage(null)}><X size={14} /> 移除截图</button></> : <button type="button" aria-label="选择待查证截图" disabled={working || locked} onClick={() => file.current?.click()}><ImagePlus size={32} /><strong>选择截图，或拖放到这里</strong><span>也可聚焦此区域后粘贴图片</span><small>JPG、PNG、WebP，最大 5 MB</small></button>}
      </div><label className="form-field">补充问题（选填）<textarea value={input} maxLength={12000} rows={3} disabled={working || locked} onChange={event => setInput(event.target.value)} placeholder="例如：截图里的温度说法是否成立？请区分比较条件。" /></label><div className="form-field"><span>查证来源范围</span><SourcePicker values={sources} change={value => { if (!working && !locked) setSources(value); }} /></div><button className="button primary full-width" disabled={working || locked || !image || !sources.length} onClick={verify}>{working ? <Loader2 className="spin" size={16} /> : <Search size={16} />}{working ? "正在识别、检索并逐条核对…" : "开始截图查证"}</button><p className="feature-footnote">最多核对 4 条主张，每条发起 1 次检索。原图不写入云端档案；核对完成后可导出文字报告。</p></section>
      <section className="feature-panel screenshot-output-panel"><div className="feature-section-heading"><h2>查证结果</h2><FileImage size={23} /></div>
        {error && <p className="feature-message error" role="alert">{error}</p>}
        {working && <div className="feature-loading" role="status"><Loader2 className="spin" size={22} /><div><strong>正在完成本轮核对</strong><p>先读取截图，再搜索来源，最后对照资料生成逐条结果。请保持页面打开。</p></div></div>}
        {!result && !working && <div className="feature-empty"><ShieldCheck size={35} /><p>上传一张截图后，识别原文、主张和来源会在这里逐条显示。</p></div>}
        {result && <><div className={`check-result-status ${result.status}`}><Check size={16} />{result.status === "complete" ? "已完成本轮核对" : "部分完成，请继续核查未知内容"}<small>发起 {result.usedSearches} 次检索</small></div><details className="ocr-original" open><summary>识别原文，请对照截图核读</summary><p>{result.extractedText}</p></details>
          <div className="check-claims">{result.results.map((item, index) => <article className={`check-claim ${item.verdict}`} key={item.claimId}><div className="check-claim-top"><span>主张 {index + 1}</span><strong>{item.verdict === "supported" ? "资料支持" : item.verdict === "refuted" ? "资料反驳" : "证据不足"}</strong></div><h3>{item.claim}</h3><p>{item.explanation}</p>{item.evidenceIds.length ? <ul>{item.evidenceIds.map(id => { const entry = result.evidence.find(e => e.id === id); return entry && safeUrl(entry.url) ? <li key={id}><a href={safeUrl(entry.url)!} target="_blank" rel="noreferrer">{entry.title}<ArrowUpRight size={13} /></a><small>{sourceName(entry.source)}</small></li> : null; })}</ul> : <small>尚无可用于判断的来源，保留未知。</small>}</article>)}</div>
          <details className="check-source-details"><summary>查看本轮全部 {result.evidence.length} 条检索来源</summary>{result.evidence.map(entry => safeUrl(entry.url) && <a key={entry.id} href={safeUrl(entry.url)!} target="_blank" rel="noreferrer">{entry.title}<ArrowUpRight size={13} /></a>)}</details>
          {result.errors?.length ? <div className="feature-message error">{result.errors.map((issue, i) => <p key={i}>{issue.message}</p>)}</div> : null}
          <ul className="feature-limitations">{result.limitations.map((value, i) => <li key={i}>{value}</li>)}</ul><div className="feature-actions"><button className="button" onClick={() => saveFile("循证-截图查证报告.md", checkReport(result), "text/markdown;charset=utf-8")}><ArrowDownToLine size={14} /> 导出查证报告</button><button className="text-button" onClick={() => saveFile("循证-截图查证记录.json", JSON.stringify(result, null, 2), "application/json;charset=utf-8")}>导出查询记录 JSON</button></div><small className="feature-footnote">核对时间：{time(result.createdAt)}（北京时间）。请求编号：{result.requestIds.join("、") || "无"}</small>
        </>}
      </section></div><p className="feature-scope-note"><ShieldCheck size={17} />结果依据检索资料初步核对，仍需打开原文。当前不提供反向搜图、原图溯源或图像篡改鉴定。</p>
    </>}
  </div>;
}

const runName = { baseline: "建立基线", changed: "发现变化", unchanged: "本轮无变化", error: "复查失败" };
const changeName = { new: "新来源", changed: "摘要变化", removed: "本轮未返回", unchanged: "未变化" };
function RunDetails({ run }: { run: MonitorRun }) {
  return <details className={`monitor-run ${run.status}`}><summary><span>{runName[run.status]}</span><time>{time(run.createdAt)}</time><small>新增 {run.newCount} · 变化 {run.changedCount} · 未返回 {run.removedCount}</small></summary><p>{run.summary}</p><ul>{run.items.map((item, i) => <li key={`${item.url}-${i}`}><span>{changeName[item.change]}</span>{safeUrl(item.url) ? <a href={safeUrl(item.url)!} target="_blank" rel="noreferrer">{item.title}<ArrowUpRight size={12} /></a> : <span>{item.title}</span>}</li>)}</ul>{run.requestId && <small>SearchPro 请求编号：{run.requestId}</small>}</details>;
}

export function MonitorWorkspace({ account, onLogin, locked, setActivity, initialCase, onUnreadChange }: { account: AccountStatus | null; onLogin: () => void; locked: boolean; setActivity: (active: boolean) => void; initialCase: Investigation; onUnreadChange: (count: number) => void }) {
  const [monitors, setMonitors] = useState<MonitorJob[]>([]); const [loading, setLoading] = useState(false); const [working, setWorking] = useState("");
  const [title, setTitle] = useState(initialCase.title); const [query, setQuery] = useState(initialCase.steps[0]?.query || initialCase.input.slice(0, 500));
  const [sources, setSources] = useState<SourceId[]>(initialCase.sources); const [interval, setInterval] = useState(6); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const identity = account?.user?.id; const request = useRef(0);
  async function refresh() {
    const version = ++request.current; if (!identity) return;
    setLoading(true);
    try { const result = await featureApi<{ monitors: MonitorJob[]; unreadCount: number }>("/api/monitors"); if (version === request.current) { setMonitors(result.monitors); onUnreadChange(result.unreadCount); setError(""); } }
    catch (problem) { if (version === request.current) setError(errorText(problem)); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { setMonitors([]); setMessage(""); setError(""); request.current += 1; if (identity) void refresh(); }, [identity]);
  function useCurrent() { setTitle(initialCase.title); setQuery(initialCase.steps[0]?.query || initialCase.input.slice(0, 500)); setSources(initialCase.sources); }
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (working || locked) return; setWorking("create"); setActivity(true); setError(""); setMessage("");
    try { const { monitor } = await featureApi<{ monitor: MonitorJob }>("/api/monitors", "POST", { title: title.trim(), query: query.trim(), sources, intervalHours: interval, caseId: initialCase.id }); setMonitors(previous => [monitor, ...previous]); setMessage("盯梢任务已保存。可立即复查建立基线，之后由后台按计划复查。"); }
    catch (problem) { setError(errorText(problem)); } finally { setWorking(""); setActivity(false); }
  }
  async function operate(job: MonitorJob, action: "run" | "toggle" | "read") {
    if (working || locked) return; setWorking(`${job.id}-${action}`); setActivity(true); setError(""); setMessage("");
    try {
      const result = action === "run" ? await featureApi<{ monitor: MonitorJob; run: MonitorRun }>(`/api/monitors/${job.id}/run`, "POST", {}) : await featureApi<{ monitor: MonitorJob }>(`/api/monitors/${job.id}`, "PATCH", action === "toggle" ? { enabled: !job.enabled } : { read: true });
      const next = monitors.map(item => item.id === result.monitor.id ? result.monitor : item);
      setMonitors(next); onUnreadChange(next.reduce((sum, item) => sum + item.unreadCount, 0));
      setMessage(action === "run" ? result.monitor.runs[0]?.summary || "本轮复查已完成。" : action === "toggle" ? result.monitor.enabled ? "已恢复后台盯梢。" : "已暂停后台盯梢。" : "变化记录已标为已读。");
    } catch (problem) { setError(errorText(problem)); } finally { setWorking(""); setActivity(false); }
  }
  return <div className="workspace standalone page-enter feature-workspace"><PageTitle eyebrow="CONTINUOUS WATCH" title="持续盯梢公开信息" description="将一个查询保存为后台任务，定期比较检索结果，记录新来源和摘要变化。离开网页后，已启用的任务仍按计划复查。" action={identity ? <button className="button" disabled={loading || !!working || locked} onClick={refresh}><RefreshCw size={14} className={loading ? "spin" : ""} />刷新记录</button> : undefined} />
    {!account?.user ? <LoginGate title="登录后创建持续盯梢" description="盯梢任务与变化记录保存在你的账号下，可暂停、恢复和查看历史。" onLogin={onLogin} /> : <>
      {error && <p className="feature-message error" role="alert">{error}</p>}{message && <p className="feature-message success" role="status">{message}</p>}
      <div className="monitor-layout"><form className="feature-panel monitor-form" onSubmit={create}><div className="feature-section-heading"><h2>新增盯梢任务</h2><Bell size={23} /></div><button type="button" className="text-button" disabled={!!working || locked} onClick={useCurrent}>使用当前调查的查询词 <ArrowRight size={13} /></button><label className="form-field">任务名称<input required maxLength={160} value={title} disabled={!!working || locked} onChange={event => setTitle(event.target.value)} /></label><label className="form-field">持续复查的检索词<textarea required maxLength={1000} rows={3} value={query} disabled={!!working || locked} onChange={event => setQuery(event.target.value)} /></label><div className="form-field"><span>来源范围</span><SourcePicker values={sources} change={value => { if (!working && !locked) setSources(value); }} /></div><label className="form-field">复查间隔<select value={interval} disabled={!!working || locked} onChange={event => setInterval(Number(event.target.value))}><option value={1}>每 1 小时</option><option value={6}>每 6 小时</option><option value={24}>每 24 小时</option></select></label><button className="button primary full-width" disabled={!!working || locked || !sources.length || !title.trim() || !query.trim()}>{working === "create" ? <Loader2 className="spin" size={15} /> : <Bell size={15} />} 保存盯梢任务</button><p className="feature-footnote">每次复查发起 1 次元宝搜索，每个账号最多启用 3 个任务。默认每 6 小时复查，后台调度按小时检查到期任务。</p></form>
      <section className="monitor-list" aria-label="我的盯梢任务">{loading && !monitors.length ? <div className="feature-panel feature-loading"><Loader2 className="spin" size={18} /> 正在读取盯梢记录…</div> : !monitors.length ? <div className="feature-panel feature-empty"><Bell size={34} /><h2>还没有盯梢任务</h2><p>保存一个查询，再建立基线。后续变化会出现在这里和导航提醒中。</p></div> : monitors.map(job => <article className="feature-panel monitor-job" key={job.id}><div className="feature-section-heading"><div><span className={`monitor-enabled ${job.enabled ? "enabled" : ""}`}>{job.enabled ? "后台盯梢已启用" : "已暂停"}</span><h2>{job.title}</h2></div>{job.unreadCount > 0 && <button className="monitor-unread" disabled={!!working || locked} onClick={() => operate(job, "read")} aria-label={`将${job.title}的${job.unreadCount}条变化标为已读`}><Bell size={14} /> {job.unreadCount} 条未读</button>}</div><p className="monitor-query">{job.query}</p><div className="monitor-meta"><span>每 {job.intervalHours} 小时</span><span>{job.sources.map(sourceName).join("、")}</span></div><dl className="monitor-times"><div><dt>最近复查</dt><dd>{time(job.lastRunAt)}</dd></div><div><dt>下次到期</dt><dd>{job.enabled ? time(job.nextRunAt) : "暂停期间不自动复查"}</dd></div></dl>{job.lastError && <p className="feature-message error">{job.lastError}</p>}<div className="feature-actions"><button className="button primary" disabled={!!working || locked} onClick={() => operate(job, "run")}>{working === `${job.id}-run` ? <Loader2 className="spin" size={14} /> : <Search size={14} />} {job.runs.length ? "立即复查" : "建立基线"}</button><button className="button" disabled={!!working || locked} onClick={() => operate(job, "toggle")}>{job.enabled ? <Pause size={14} /> : <Play size={14} />}{job.enabled ? "暂停任务" : "恢复任务"}</button></div><h3 className="monitor-history-title">复查历史 <span>{job.runs.length}</span></h3>{job.runs.length ? job.runs.map(run => <RunDetails key={run.id} run={run} />) : <p className="feature-footnote">还没有基线，首次复查将保存当前结果。没有基线时不判断变化。</p>}</article>)}</section></div>
      <p className="feature-scope-note"><ShieldCheck size={17} />站内提醒会保留到下次访问。监测的是搜索结果与摘要变化，不是网页正文逐字比对；本轮未返回的来源也不能据此判定失实。当前未接入微信或邮件推送。</p>
    </>}
  </div>;
}
