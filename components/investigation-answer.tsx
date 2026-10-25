"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, FileCheck2, Loader2, Pencil, Sparkles } from "lucide-react";
import { answerEvidence, getBranchAnswer, isAnswerCurrent, verdictLabel } from "@/lib/answers";
import { safeUrl } from "@/lib/investigation";
import type { BranchAnswer, Investigation } from "@/lib/types";
import "./investigation-answer.css";

type Draft = Pick<BranchAnswer, "answer" | "verdict" | "reason" | "limitations" | "evidenceIds">;
export function InvestigationAnswer({ item, busy, generating, canGenerate, generate, save, login }: { item: Investigation; busy: boolean; generating: boolean; canGenerate: boolean; generate: () => void; save: (draft: Draft) => void; login: () => void }) {
  const answer = getBranchAnswer(item);
  const current = !!answer && isAnswerCurrent(item, answer);
  const available = answerEvidence(item);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>({ answer: "", verdict: "insufficient", reason: "", limitations: [], evidenceIds: [] });
  useEffect(() => {
    const ids = new Set(available.map(e => e.id));
    setDraft(answer ? { answer: answer.answer, verdict: answer.verdict, reason: answer.reason, limitations: answer.limitations, evidenceIds: answer.evidenceIds.filter(id => ids.has(id)) } : { answer: "", verdict: "insufficient", reason: "", limitations: [], evidenceIds: [] });
    setEditing(false); setError("");
  }, [item.id, item.activeBranch, answer?.fingerprint, answer?.createdAt]);
  const citations = available.filter(e => answer?.evidenceIds.includes(e.id));
  return <section className="answer-panel" aria-label="可能答案与暂定结论">
    <div className="answer-heading"><div><FileCheck2 size={19} /><h2>可能答案与暂定结论</h2><span className={`answer-verdict ${current ? answer.verdict : "insufficient"}`}>{current ? verdictLabel(answer.verdict) : answer ? "需要重新核验" : "尚未形成判断"}</span></div><div className="answer-actions"><button className="text-button" disabled={busy} onClick={() => { setEditing(!editing); setError(""); }}><Pencil size={13} />{editing ? "收起编辑" : answer ? "修改暂定结论" : "填写暂定结论"}</button><button className="button primary" disabled={busy || canGenerate && !available.length} onClick={canGenerate ? generate : login}>{generating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{generating ? "正在整理答案…" : canGenerate ? "生成可能答案" : "登录生成答案"}</button></div></div>
    {current && <div className="answer-content"><div className="answer-origin">{answer.origin === "model" ? "模型整理 · 基于本分支已收集摘要" : "人工暂定判断 · 请核读所引原文"}</div><p className="answer-summary">{answer.answer}</p><h3>判断依据</h3><p>{answer.reason}</p>{citations.length > 0 && <div className="answer-citations">{citations.map((e,i) => <a key={e.id} href={safeUrl(e.url) || undefined} target="_blank" rel="noreferrer">[{i+1}] {e.title}<ArrowUpRight size={12} /></a>)}</div>}<h3>未解问题与适用范围</h3><ul>{(answer.limitations.length ? answer.limitations : ["仍需打开引用原文核对语境、日期与适用条件。"]).map((line,i) => <li key={i}>{line}</li>)}</ul></div>}
    {!current && <div className="answer-empty"><p>{answer ? "本分支的资料或调查步骤已变化，上一份结论需要重新核验。" : available.length ? `当前分支已收录 ${available.length} 条可引用资料。可以据此生成可能答案，或在核读原文后填写暂定结论。` : "先检索或补充来源，再整理可能答案；没有证据时保留“资料不足”。"}</p>{answer && <details><summary>查看旧结论（不作为当前判断）</summary><p>{answer.answer}</p><p>{answer.reason}</p></details>}</div>}
    {editing && <form className="answer-editor" onSubmit={e => { e.preventDefault(); try { save(draft); setEditing(false); setError(""); } catch (error) { setError((error as Error).message); } }}>
      <label className="form-field">可能答案或暂定结论<textarea required maxLength={5000} rows={3} value={draft.answer} disabled={busy} onChange={e => setDraft({ ...draft, answer: e.target.value })} placeholder="说明目前最可能的答案，以及哪些条件尚未确认。" /></label>
      <label className="form-field">判断状态<select value={draft.verdict} disabled={busy} onChange={e => setDraft({ ...draft, verdict: e.target.value as BranchAnswer["verdict"] })}><option value="insufficient">资料不足</option><option value="supported">资料支持</option><option value="contradicted">资料反驳</option><option value="mixed">资料存在分歧</option></select></label>
      <label className="form-field">判断依据<textarea required maxLength={5000} rows={2} disabled={busy} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} placeholder="所引资料如何支持这个判断？请保留适用条件。" /></label>
      <fieldset disabled={busy}><legend>引用本分支来源</legend><p>支持、反驳或分歧判断必须附来源；预置演示资料不作为真实引用。</p><div className="answer-source-options">{available.map(e => <label key={e.id}><input type="checkbox" checked={draft.evidenceIds.includes(e.id)} onChange={event => setDraft({ ...draft, evidenceIds: event.target.checked ? [...draft.evidenceIds,e.id] : draft.evidenceIds.filter(id => id !== e.id) })} /><span>{e.title}</span></label>)}</div></fieldset>
      <label className="form-field">未解问题与适用范围（每行一条）<textarea maxLength={5000} rows={2} disabled={busy} value={draft.limitations.join("\n")} onChange={e => setDraft({ ...draft, limitations: e.target.value.split("\n") })} /></label>
      {error && <p className="answer-error" role="alert">{error}</p>}<div className="answer-editor-actions"><span>保存在本机档案；可通过“账号与云端”手动保存。</span><button className="button primary" disabled={busy} type="submit">保存暂定结论</button></div>
    </form>}
    <p className="answer-footnote">这是基于已收集资料的暂定判断，摘要可能缺少上下文。请打开原文核验；新证据可能改变答案。</p>
  </section>;
}
