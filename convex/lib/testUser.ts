import type { convexTest } from "convex-test";

/** The email the tests allow-list; a GitHub sign-in stores exactly this shape. */
export const TEST_EMAIL = "pl@pldagenais.com";

/**
 * Sign in the way Convex Auth does: insert a `users` row and present a subject
 * of `<userId>|<sessionId>`. Matching that shape is what makes these tests
 * catch an identity mismatch instead of papering over one — the JWT carries no
 * email or login, so the guard must reach the user document to find them.
 */
export async function asAllowedUser(
  t: ReturnType<typeof convexTest>,
  email: string = TEST_EMAIL,
) {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email, name: "Pierre-Luc Dagenais" }),
  );
  return t.withIdentity({ subject: `${userId}|session1` });
}
