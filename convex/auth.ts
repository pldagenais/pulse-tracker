import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * GitHub OAuth. Being signed in is not sufficient — every user-facing
 * function additionally checks the login against ALLOWED_GITHUB_LOGINS
 * (see lib/guards.ts), so this stays a single-user dashboard.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub],
});
