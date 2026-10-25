"use client";
import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { previewNodeDeletion } from "@/lib/node-mutations";
import type { Investigation } from "@/lib/types";

export function NodeEditor({ item, nodeId, mode, busy, close, save, remove }: { item: Investigation; nodeId: string; mode: "edit" | "delete"; busy: boolean; close: () => void; save: (draft: { title: string; note: string }) => void; remove: () => void }) {
  const node = item.commits.find(c => c.id === nodeId);
  const [title, setTitle] = useState(node?.title || "");
  const [note, setNote] = useState(node?.note || "");
  const [error, setError] = useState("");
  if (!node) return null;
  const preview = previewNodeDeletion(item, nodeId);
  function action() { try { if (mode === "edit") save({ title, note }); else remove(); } catch (e) { setError((e as Error).message); } }
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) close(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "编辑调查节点" : "删除调查节点"}><div className="modal-heading"><div><span className="eyebrow">整理调查记录</span><h2>{mode === "edit" ? "修改节点标题与笔记" : "删除这个节点？"}</h2></div><button className="icon-button" aria-label="关闭节点编辑" disabled={busy} onClick={close}><X size={20} /></button></div>
    {mode === "edit" ? <><label className="form-field">节点标题<input autoFocus value={title} disabled={busy} maxLength={500} onChange={e => setTitle(e.target.value)} /></label><label className="form-field">调查笔记<textarea rows={5} value={note} disabled={busy} maxLength={5000} onChange={e => setNote(e.target.value)} placeholder="补充这个发现的含义、适用条件或后续问题。" /></label><details className="node-original"><summary>{node.type === "search" ? "原始检索词与执行记录（保留原样）" : "查看原始记录"}</summary><p>{node.description}</p>{node.requestId && <code>请求编号：{node.requestId}</code>}</details><p className="modal-description">修改标题与笔记不会改写已经执行的查询。要更改后续检索，请在调查计划中修改查询词。</p></> : <><p className="modal-description">“{node.title}”</p><div className="node-deletion-summary"><p>只移除这个节点，后续节点会接到它的父节点。</p><p>影响 {preview.childCount} 个后续节点、{preview.branchCount} 个分支的历史。如果它是分支最新进度，进度会回退到父节点。</p><p>本节点的 {preview.exclusiveEvidenceCount} 条独有引用会退出这部分调查历史；原始资料仍保留，共享来源继续可用。</p></div><p className="modal-description">删除后可以撤销；已有结论如受影响，会提示重新核验。</p>{!preview.canDelete && <p className="node-action-error">{preview.reason}</p>}</>}
    {error && <p className="node-action-error" role="alert">{error}</p>}<div className="modal-bottom"><button className="text-button" disabled={busy} onClick={close}>取消</button><button className={`button ${mode === "delete" ? "danger-button" : "primary"}`} disabled={busy || mode === "edit" && !title.trim() || mode === "delete" && !preview.canDelete} onClick={action}>{mode === "edit" ? <Pencil size={14} /> : <Trash2 size={14} />}{mode === "edit" ? "保存节点修改" : "确认删除节点"}</button></div></section></div>;
}
