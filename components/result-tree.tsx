"use client";
import { ArrowUpRight, BookOpen, CheckCircle2, CircleHelp, FileText, GitBranch, Search, Target } from "lucide-react";
import { hostName, relationName, safeUrl, sourceName } from "@/lib/investigation";
import { buildResultTree } from "@/lib/result-tree";
import type { ResultTreeGroup, ResultTreeSource } from "@/lib/result-tree";
import type { Investigation } from "@/lib/types";
import "./result-tree.css";

const states = {
  pending: "尚未检索", running: "正在检索", blocked: "本步待继续", changed: "查询已调整，待重查",
  found: "已有来源", empty: "最近一轮未发现有效线索", sample: "预置示例记录", recorded: "历史查询记录",
};

function SourceNode({ source, selected, select }: { source: ResultTreeSource; selected: string; select: (id: string) => void }) {
  const entry = source.evidence;
  const url = safeUrl(entry.url);
  return <li className="result-tree-source">
    <article className={`result-tree-source-card ${selected === source.commitId ? "record-selected" : ""}`}>
      <div className="result-tree-source-meta"><span>{sourceName(entry.source)}</span><span className={`result-tree-relation ${entry.relation}`}>人工标记 · {relationName(entry.relation)}</span><span className={entry.kind === "demo" ? "result-tree-sample" : ""}>{entry.kind === "demo" ? "预置示例" : entry.kind === "manual" ? "人工补充" : "检索收录"}</span></div>
      {url ? <a className="result-tree-source-title" href={url} target="_blank" rel="noreferrer">{entry.title}<ArrowUpRight size={14} /></a> : <strong className="result-tree-source-title">{entry.title}</strong>}
      <div className="result-tree-source-actions"><span>{hostName(entry.url)}</span><button type="button" onClick={() => select(source.commitId)} aria-pressed={selected === source.commitId} aria-label={`查看来源收录记录：${entry.title}`}>查看收录记录</button></div>
      <details className="result-tree-source-excerpt"><summary>展开摘要与来源信息</summary><p>{entry.snippet || "这条来源没有保存摘要，请打开原文继续核查。"}</p><small>收录：{entry.retrievedAt}{entry.publishedAt ? ` · 发布：${entry.publishedAt}` : ""}</small>{url && <a href={url} target="_blank" rel="noreferrer">打开原始页面 <ArrowUpRight size={12} /></a>}</details>
    </article>
  </li>;
}

function GroupNode({ group, selected, select }: { group: ResultTreeGroup; selected: string; select: (id: string) => void }) {
  const first = group.sources.slice(0, 5);
  const more = group.sources.slice(5);
  return <li className="result-tree-group">
    <details open className={`result-tree-question ${group.latestCommitId === selected ? "record-selected" : ""}`}>
      <summary><span className="result-tree-question-title">{group.title}</span><span className={`result-tree-state ${group.state}`}>{states[group.state]}</span><span className="result-tree-source-count">{group.sources.length} 条来源</span></summary>
      <div className="result-tree-question-body">
        {group.description && <p className="result-tree-method">{group.description}</p>}
        {group.query && <div className="result-tree-query"><Search size={13} /><span>{group.query}</span></div>}
        {group.latestCommitId && <button type="button" className="result-tree-view-record" onClick={() => select(group.latestCommitId!)} aria-pressed={selected === group.latestCommitId} aria-label={`查看树节点记录：${group.title}`}>查看这一步的记录</button>}
        {group.state === "empty" && <p className="result-tree-no-result">最近一次检索没有返回有效线索，这不代表原说法已被证伪。{group.sources.length ? "下面仍保留此前已收录的来源。" : "可调整查询词或扩大来源范围继续查。"}</p>}
        {group.state === "changed" && <p className="result-tree-no-result">当前查询词还没有对应的检索记录。{group.sources.length ? "下面是此前查询留下的资料。" : "执行检索后会在这里展开来源。"}</p>}
        {!group.sources.length && group.state !== "empty" && group.state !== "changed" && <p className="result-tree-awaiting"><CircleHelp size={15} />{group.state === "blocked" ? "本步没有可引用来源，检查失败原因后可继续检索。" : group.state === "running" ? "正在寻找来源，返回后会自动收录。" : "这里还没有可引用来源，调查步骤本身不是证据。"}</p>}
        {!!group.sources.length && <ul className="result-tree-sources">{first.map(source => <SourceNode key={source.evidence.id} source={source} selected={selected} select={select} />)}{more.length > 0 && <li className="result-tree-more"><details><summary>展开其余 {more.length} 条来源</summary><ul>{more.map(source => <SourceNode key={source.evidence.id} source={source} selected={selected} select={select} />)}</ul></details></li>}</ul>}
      </div>
    </details>
  </li>;
}

export function ResultTree({ item, selected, select, onOpenReport }: { item: Investigation; selected: string; select: (commitId: string) => void; onOpenReport?: () => void }) {
  const tree = buildResultTree(item);
  return <section className="result-tree" aria-label="调查结果树">
    <div className="result-tree-intro"><div><BookOpen size={17} /><strong>按问题展开调查结果</strong></div><span>问题 → 子问题 → 原始来源</span></div>
    <div className="result-tree-root"><Target size={21} /><div><span className="result-tree-level">调查问题</span><h2>{item.title}</h2><p>{item.input}</p></div></div>
    <ul className="result-tree-directions"><li><details open key={`${item.id}:${item.activeBranch}`} className="result-tree-direction"><summary><GitBranch size={16} /><strong>{tree.direction}</strong><span>{tree.isMain ? "主要调查方向" : "核验分支"}</span><small>{tree.sourceCount} 条来源 · {tree.searchCount} 次真实检索</small></summary><div className="result-tree-direction-body">{tree.sampleSourceCount > 0 && <p className="result-tree-example-note"><FileText size={14} />含 {tree.sampleSourceCount} 条预置示例资料，不能作为本次真实查询记录。</p>}{tree.groups.length ? <ul className="result-tree-groups">{tree.groups.map(group => <GroupNode key={`${item.id}:${item.activeBranch}:${group.id}`} group={group} selected={selected} select={select} />)}</ul> : <p className="result-tree-empty">还没有调查子问题。先创建调查计划或补充原始来源，再继续展开。</p>}</div></details></li></ul>
    <div className="result-tree-footer"><p><CheckCircle2 size={14} />同一来源可用于多个子问题；总数按来源去重。人工标签不等于最终结论。</p>{onOpenReport && <button type="button" onClick={onOpenReport}>查看可能答案与报告 <ArrowUpRight size={13} /></button>}</div>
  </section>;
}
