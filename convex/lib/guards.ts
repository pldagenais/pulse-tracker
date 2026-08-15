import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/**
 * Allow-list check. Fails closed: an empty list or an empty identity denies
 * access, so a missing env var can never open the app up.
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
 * signed in as an allow-listed user. Returns the matched identity.
 *
 * The identity comes from the `users` row, not from the JWT: Convex Auth signs
 * only sub/iss/aud/iat/exp, so `getUserIdentity()` carries no email, name, or
 * GitHub login to match against.
 */
export async function requireUser(ctx: Ctx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const user = await ctx.db.get(userId);
  const allowList = process.env.ALLOWED_USERS ?? process.env.ALLOWED_GITHUB_LOGINS ?? "";
  const email = user?.email ?? "";
  if (!isAllowed(email, allowList)) throw new Error("Account not permitted");
  return email;
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
