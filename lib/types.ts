export type SourceId = "official" | "news" | "xiaohongshu" | "bilibili" | "web";
export type StepStatus = "pending" | "running" | "done" | "blocked";
export type EvidenceRelation = "supports" | "contradicts" | "context";
export interface PlanStep { id: string; title: string; description: string; query: string; sources: SourceId[]; status: StepStatus; }
export interface Evidence { id: string; title: string; url: string; snippet: string; source: SourceId; publishedAt?: string; retrievedAt: string; relation: EvidenceRelation; stepId?: string; kind: "search" | "manual" | "demo"; }
export interface Commit { id: string; parents: string[]; branch: string; title: string; description: string; type: "init" | "plan" | "search" | "evidence" | "merge"; createdAt: string; evidenceIds: string[]; stepId?: string; searchMode?: "live"; requestId?: string; note?: string; }
export interface Branch { id: string; name: string; head: string; color: string; }
export interface Investigation { id: string; title: string; input: string; inputUrl?: string; imageName?: string; createdAt: string; updatedAt: string; sources: SourceId[]; steps: PlanStep[]; evidence: Evidence[]; commits: Commit[]; branches: Branch[]; activeBranch: string; mode: "demo" | "live"; report?: string; answers?: BranchAnswer[]; }
export interface PlanRequest { input: string; url?: string; image?: string; sources: SourceId[]; }
export interface PlanResponse { title: string; steps: PlanStep[]; mode: "demo" | "live"; notice?: string; extractedText?: string; }
export interface SearchRequest { query: string; sources: SourceId[]; stepId?: string; limit?: number; }
export interface SearchResponse { results: Evidence[]; mode: "live" | "unconfigured"; notice?: string; used?: number; requestId?: string; }
export interface ProviderStatus { model: { configured: boolean; provider: string; model: string }; search: { configured: boolean; provider: string }; wechat: { configured: boolean }; }

export type AnswerVerdict = "supported" | "contradicted" | "mixed" | "insufficient";
export interface BranchAnswerDraft { answer: string; verdict: AnswerVerdict; reason: string; limitations: string[]; evidenceIds: string[]; }
export interface BranchAnswer extends BranchAnswerDraft { branchId: string; fingerprint: string; origin: "model" | "manual"; createdAt: string; }
