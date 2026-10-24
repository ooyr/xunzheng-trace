import type { AccountStatus, AccountUser } from "../account-types";
import { ApiError, jsonResponse } from "./http";

export const GUEST_LIMITS = { plan: 2, search: 3 } as const;
const SESSION_DAYS = 7;
const encoder = new TextEncoder();
export async function database(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new ApiError(503, "账号存储暂未就绪，请稍后再试。", "STORAGE_UNAVAILABLE");
  return db;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "请从作品网页中发起此操作。", "INVALID_ORIGIN");
}
export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left); const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) mismatch |= (a[i] || 0) ^ (b[i] || 0);
  return mismatch === 0;
}
export function randomHex(length = 32): string { return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function hashText(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function passwordDigest(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  // Workers 的 PBKDF2 单次迭代上限为十万；随机盐确保相同密码产生不同摘要。
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 }, key, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function credentials(value: Record<string, unknown>): { username: string; password: string } {
  if (typeof value.username !== "string" || !/^[a-zA-Z0-9_-]{3,32}$/.test(value.username.trim())) throw new ApiError(400, "账号名请使用 3 至 32 位字母、数字、下划线或短横线。", "INVALID_USERNAME");
  if (typeof value.password !== "string" || value.password.length < 10 || value.password.length > 128) throw new ApiError(400, "密码长度应为 10 至 128 个字符。", "INVALID_PASSWORD");
  return { username: value.username.trim().toLowerCase(), password: value.password };
}
function sessionToken(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") || "";
  const name = new URL(request.url).protocol === "https:" ? "__Host-trace_session" : "trace_session";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`));
  return match?.[1];
}
export async function getUser(request: Request, db?: D1Database): Promise<AccountUser | null> {
  const token = sessionToken(request); if (!token) return null;
  const storage = db || await database();
  const row = await storage.prepare("SELECT u.id, u.username, u.created_at FROM trace_sessions s JOIN trace_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hashText(token), new Date().toISOString()).first<{ id: string; username: string; created_at: string }>();
  return row ? { id: row.id, username: row.username, createdAt: row.created_at } : null;
}
export async function requireUser(request: Request, db?: D1Database): Promise<AccountUser> {
  const user = await getUser(request, db);
  if (!user) throw new ApiError(401, "请先使用账号密码登录，再使用这项高级功能。", "LOGIN_REQUIRED");
  return user;
}
export function beijingDay(now = Date.now()): string { return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function dayReset(now = Date.now()): string { const day = beijingDay(now); return new Date(Date.parse(`${day}T00:00:00+08:00`) + 86400000).toISOString(); }
// Workers 不允许在模块初始化阶段调用随机数；仅在真实请求中初始化开发环境备用签名盐。
let localGuestSecret: string | undefined;
function guestCookieName(request: Request): string { return new URL(request.url).protocol === "https:" ? "__Host-trace_guest" : "trace_guest"; }
async function guestSignature(value: string): Promise<string> {
  const secret = process.env.MONITOR_RUNNER_TOKEN || (localGuestSecret ||= randomHex());
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function guestCookie(request: Request): Promise<{ id: string; cookie?: string }> {
  const name = guestCookieName(request); const found = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{32})\\.([0-9]{13})\\.([a-f0-9]{64})(?:;|$)`));
  if (found && Number(found[2]) > Date.now() && constantTimeEqual(await guestSignature(`${found[1]}.${found[2]}`), found[3])) return { id: found[1] };
  const id = randomHex(16); const expires = String(Date.now() + 7 * 86400000); const signed = `${id}.${expires}.${await guestSignature(`${id}.${expires}`)}`;
  return { id, cookie: `${name}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` };
}
async function visitorKey(request: Request): Promise<string> {
  const trustedIp = request.headers.get("cf-connecting-ip");
  if (trustedIp) return hashText(`ip:${trustedIp}`);
  const guest = await guestCookie(request);
  if (guest.cookie) throw new ApiError(401, "请先打开作品网页以建立访客会话，再继续操作。", "GUEST_SESSION_REQUIRED");
  return hashText(`browser:${guest.id}`);
}
export async function reserveLimit(db: D1Database, key: string, limit: number, resetAt: string): Promise<number | null> {
  const result = await db.prepare("INSERT INTO trace_limits (key,used,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET used=used+1 WHERE used<? RETURNING used").bind(key, resetAt, limit).first<{ used: number }>();
  return result?.used ?? null;
}
export async function consumeGuestQuota(request: Request, kind: keyof typeof GUEST_LIMITS, image = false, storage?: D1Database): Promise<AccountUser | null> {
  assertSameOrigin(request);
  const user = await getUser(request, storage); if (user) return user;
  if (image) throw new ApiError(401, "截图查证属于账号高级功能，请先登录。", "LOGIN_REQUIRED");
  const db = storage || await database(); const now = Date.now();
  const key = `guest:${kind}:${beijingDay(now)}:${await visitorKey(request)}`;
  const used = await reserveLimit(db, key, GUEST_LIMITS[kind], dayReset(now));
  if (used === null) throw new ApiError(429, `访客今日 ${GUEST_LIMITS[kind]} 次${kind === "plan" ? "拆解" : "检索"}已用完，登录后继续调查。`, "GUEST_QUOTA_EXCEEDED");
  return null;
}
export async function accountStatus(request: Request, storage?: D1Database): Promise<AccountStatus> {
  const db = storage || await database(); const user = await getUser(request, db); const visitor = await visitorKey(request); const day = beijingDay();
  const values = await Promise.all((["plan", "search"] as const).map(async (kind) => { const row = await db.prepare("SELECT used FROM trace_limits WHERE key=?").bind(`guest:${kind}:${day}:${visitor}`).first<{ used: number }>(); const used = row?.used || 0; return [kind, { limit: GUEST_LIMITS[kind], used, remaining: Math.max(0, GUEST_LIMITS[kind] - used) }] as const; }));
  return { user, limits: Object.fromEntries(values) as AccountStatus["limits"], storageConfigured: true };
}
export async function accountStatusResponse(request: Request, storage?: D1Database): Promise<Response> {
  const guest = await guestCookie(request);
  // 无可信边缘 IP 的预览或代理环境使用签名访客 Cookie，避免把所有用户归入同一配额桶。
  // 本地 SSR 与 Workers 的 Request 可能来自不同运行域，按 URL 重建只读状态请求。
  const identified = guest.cookie ? new Request(request.url, { method: "GET", headers: new Headers(request.headers) }) : request;
  if (guest.cookie) {
    const retained = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => part && !part.startsWith(`${guestCookieName(request)}=`));
    identified.headers.set("Cookie", [...retained, guest.cookie.split(";")[0]].join("; "));
  }
  const response = jsonResponse(await accountStatus(identified, storage));
  if (guest.cookie) response.headers.set("Set-Cookie", guest.cookie);
  return response;
}
function cookieHeader(request: Request, token: string, maxAge = SESSION_DAYS * 86400): string {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-trace_session" : "trace_session"}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
async function createSession(db: D1Database, request: Request, user: AccountUser): Promise<Response> {
  const token = randomHex(); const now = new Date();
  await db.batch([
    db.prepare("DELETE FROM trace_sessions WHERE token_hash IN (SELECT token_hash FROM trace_sessions WHERE expires_at<=? LIMIT 100)").bind(now.toISOString()),
    db.prepare("DELETE FROM trace_limits WHERE key IN (SELECT key FROM trace_limits WHERE reset_at<=? LIMIT 100)").bind(now.toISOString()),
  ]);
  await db.prepare("INSERT INTO trace_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(await hashText(token), user.id, new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(), now.toISOString()).run();
  const response = jsonResponse({ user }); response.headers.set("Set-Cookie", cookieHeader(request, token)); return response;
}
export async function authenticate(request: Request, value: Record<string, unknown>, register = false, storage?: D1Database): Promise<Response> {
  assertSameOrigin(request); const data = credentials(value); const db = storage || await database(); const now = Date.now(); const address = await visitorKey(request);
  const bucket = Math.floor(now / 900000);
  const attempts = await reserveLimit(db, `auth:${register ? "register" : "login"}:${address}:${bucket}`, register ? 5 : 15, new Date((bucket + 1) * 900000).toISOString());
  if (attempts === null) throw new ApiError(429, "操作过于频繁，请在 15 分钟后重试。", "AUTH_RATE_LIMIT");
  if (register) {
    const salt = randomHex(16); const user = { id: `u-${crypto.randomUUID()}`, username: data.username, createdAt: new Date(now).toISOString() };
    try { await db.prepare("INSERT INTO trace_users (id,username,password_hash,salt,created_at) VALUES (?,?,?,?,?)").bind(user.id, user.username, await passwordDigest(data.password, salt), salt, user.createdAt).run(); }
    catch (error) { if (String(error).includes("UNIQUE")) throw new ApiError(409, "这个账号名已被使用，请换一个。", "USERNAME_TAKEN"); throw error; }
    return createSession(db, request, user);
  }
  const row = await db.prepare("SELECT id,username,password_hash,salt,created_at FROM trace_users WHERE username=?").bind(data.username).first<{ id: string; username: string; password_hash: string; salt: string; created_at: string }>();
  const digest = await passwordDigest(data.password, row?.salt || "00000000000000000000000000000000");
  if (!row || !constantTimeEqual(digest, row.password_hash)) throw new ApiError(401, "账号名或密码不正确。", "INVALID_CREDENTIALS");
  return createSession(db, request, { id: row.id, username: row.username, createdAt: row.created_at });
}
export async function logout(request: Request, storage?: D1Database): Promise<Response> {
  assertSameOrigin(request); const token = sessionToken(request);
  if (token) await (storage || await database()).prepare("DELETE FROM trace_sessions WHERE token_hash=?").bind(await hashText(token)).run();
  const response = jsonResponse({ ok: true }); response.headers.set("Set-Cookie", cookieHeader(request, "", 0)); return response;
}
