import type { Evidence, SourceId } from "./types";

export interface CheckRequest { image: string; input?: string; sources: SourceId[]; }
export interface CheckClaim { id: string; claim: string; query: string; }
export type CheckVerdict = "supported" | "refuted" | "insufficient";
export interface CheckClaimResult {
  claimId: string;
  claim: string;
  verdict: CheckVerdict;
  status: "checked" | "unknown" | "error";
  explanation: string;
  evidenceIds: string[];
}
export interface CheckIssue { phase: "search" | "assessment"; claimId?: string; code: string; message: string; }
export interface CheckResponse {
  id: string;
  createdAt: string;
  status: "complete" | "partial";
  extractedText: string;
  claims: CheckClaim[];
  results: CheckClaimResult[];
  evidence: Evidence[];
  // 已实际发起的检索请求次数；失败不自动重试，是否计费由服务商决定。
  usedSearches: number;
  requestIds: string[];
  limitations: string[];
  errors?: CheckIssue[];
}
