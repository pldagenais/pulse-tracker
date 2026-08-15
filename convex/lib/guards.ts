import type { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/**
 * Allow-list check for GitHub logins. Fails closed: an empty list or an
 * empty login denies access, so a missing env var can never open the app up.
 */
export function isAllowed(login: string, allowList: string): boolean {
  if (!login) return false;
  const allowed = allowList
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(login.toLowerCase());
}

/**
 * Guard for user-facing queries and mutations. Throws unless the caller is
 * signed in with an allow-listed GitHub account. Returns the login.
 */
export async function requireUser(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const login =
    (identity.nickname as string | undefined) ??
    (identity.preferredUsername as string | undefined) ??
    "";
  if (!isAllowed(login, process.env.ALLOWED_GITHUB_LOGINS ?? "")) {
    throw new Error("Account not permitted");
  }
  return login;
}

/**
 * Guard for agent-only functions. The local server cannot perform an OAuth
 * flow, so it presents a shared secret instead. The key lives only in the
 * agent's environment and is never referenced by the web bundle.
 */
export function requireAgent(key: string): void {
  const expected = process.env.PULSE_AGENT_KEY ?? "";
  if (!expected || key !== expected) throw new Error("Bad agent key");
}
