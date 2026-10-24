export interface AccountUser { id: string; username: string; createdAt: string; }
export interface GuestLimit { limit: number; used: number; remaining: number; }
export interface AccountStatus { user: AccountUser | null; limits: { plan: GuestLimit; search: GuestLimit }; storageConfigured: boolean; }
export type MonitorChange = "new" | "changed" | "removed" | "unchanged";
export interface MonitorItem { title: string; url: string; change: MonitorChange; }
export interface MonitorRun { id: string; createdAt: string; status: "baseline" | "changed" | "unchanged" | "error"; newCount: number; changedCount: number; removedCount: number; requestId?: string; summary: string; items: MonitorItem[]; }
export interface MonitorJob { id: string; title: string; query: string; sources: import("./types").SourceId[]; intervalHours: number; caseId?: string; enabled: boolean; createdAt: string; lastRunAt?: string; nextRunAt: string; unreadCount: number; lastError?: string; runs: MonitorRun[]; }
