import type { SourceId } from "../types";
import { ApiError, publicHttpUrl } from "./http";

export const SOURCE_IDS: SourceId[] = ["official", "news", "xiaohongshu", "bilibili", "web"];
export const SOURCE_LABELS: Record<SourceId, string> = { official: "官方与学术", news: "新闻媒体", xiaohongshu: "小红书", bilibili: "哔哩哔哩", web: "全网公开来源" };
const NEWS_DOMAINS = ["news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "cnr.cn", "chinanews.com", "chinadaily.com.cn", "gmw.cn", "stdaily.com", "thepaper.cn", "bbc.com", "reuters.com", "apnews.com", "china.com.cn"];
const OFFICIAL_DOMAINS = ["nasa.gov", "esa.int", "cas.cn", "who.int", "unesco.org", "un.org", "nih.gov", "nature.com", "science.org", "waytoagi.com", "toklens.ai", "cloud.tencent.com", "developers.weixin.qq.com", "developer.work.weixin.qq.com"];
export function domainMatches(host: string, domain: string): boolean { return host === domain || host.endsWith(`.${domain}`); }

export function parseSources(value: unknown): SourceId[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5 || value.some(item => !SOURCE_IDS.includes(item as SourceId))) throw new ApiError(400, "请至少选择一种有效的搜索来源。", "INVALID_SOURCES");
  return [...new Set(value)] as SourceId[];
}

export function classifySource(url: string): SourceId | null {
  const normalized = publicHttpUrl(url);
  if (!normalized) return null;
  const host = new URL(normalized).hostname.toLowerCase();
  if (["xiaohongshu.com", "xhslink.com"].some(domain => domainMatches(host, domain))) return "xiaohongshu";
  if (["bilibili.com", "b23.tv"].some(domain => domainMatches(host, domain))) return "bilibili";
  if (NEWS_DOMAINS.some(domain => domainMatches(host, domain))) return "news";
  if (OFFICIAL_DOMAINS.some(domain => domainMatches(host, domain)) || /\.(gov|edu)(\.cn)?$/.test(host) || /\.ac\.cn$/.test(host)) return "official";
  return "web";
}

export function allowedSource(url: string, selected: SourceId[]): SourceId | null {
  const actual = classifySource(url);
  if (!actual) return null;
  return selected.includes("web") || selected.includes(actual) ? actual : null;
}

export function cleanSnippet(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, max);
}
