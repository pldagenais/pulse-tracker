import { convexTest } from "convex-test";
import { expect, test, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { asAllowedUser, TEST_EMAIL } from "./lib/testUser";

beforeEach(() => {
  // Convex Auth's JWT carries no login claim, so the allow-list keys on the
  // email stored in the users row.
  process.env.ALLOWED_USERS = TEST_EMAIL;
  process.env.ALLOWED_GITHUB_LOGINS = "";
});

async function seedSnapshot(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("snapshots", {
      key: "projects",
      kind: "projects",
      payload: [{ id: 1, name: "Pulse" }],
      updatedAt: 1,
    });
  });
}

test("reads are refused without a signed-in user", async () => {
  const t = convexTest(schema);
  await seedSnapshot(t);
  await expect(t.query(api.snapshots.get, { key: "projects" })).rejects.toThrow(
    /not signed in/i,
  );
});

test("an allow-listed user reads the snapshot payload verbatim", async () => {
  const t = convexTest(schema);
  await seedSnapshot(t);
  const asUser = await asAllowedUser(t);
  expect(await asUser.query(api.snapshots.get, { key: "projects" })).toEqual([
    { id: 1, name: "Pulse" },
  ]);
});

test("a signed-in but non-allow-listed user is refused", async () => {
  const t = convexTest(schema);
  await seedSnapshot(t);
  const asOther = await asAllowedUser(t, "intruder@example.com");
  await expect(asOther.query(api.snapshots.get, { key: "projects" })).rejects.toThrow(
    /not permitted/i,
  );
});

test("missing snapshot returns null rather than throwing", async () => {
  const t = convexTest(schema);
  const asUser = await asAllowedUser(t);
  expect(await asUser.query(api.snapshots.get, { key: "nope" })).toBeNull();
});

test("sessions.list returns payloads newest first", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const [id, startedAt] of [["old", 100], ["new", 200]] as const) {
      await ctx.db.insert("sessions", {
        sessionId: id,
        projectId: 1,
        projectName: "Pulse",
        title: id,
        startedAt,
        claudeMs: 0,
        estCostUsd: null,
        promptCount: 0,
        payload: { id },
        updatedAt: 1,
      });
    }
  });
  const asUser = await asAllowedUser(t);
  // The envelope must match GET /api/sessions: the SPA reads `.rows` in both
  // modes, and a bare array here crashes the dashboard.
  const res = await asUser.query(api.sessions.list, {});
  expect(res.rows).toEqual([{ id: "new" }, { id: "old" }]);
  expect(res.total).toBe(2);
});

test("journal.list is wrapped in the same envelope as the REST route", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("journal", {
      localId: 7,
      ts: 100,
      text: "did a thing",
      projectPath: "C:/p",
      projectName: "Pulse",
      sessionId: null,
      source: "claude",
    });
  });
  const asUser = await asAllowedUser(t);
  const res = await asUser.query(api.journal.list, {});
  expect(res.rows).toEqual([
    expect.objectContaining({ id: 7, text: "did a thing" }),
  ]);
  expect(res.total).toBe(1);
});

test("prompts.search is wrapped in the same envelope as the REST route", async () => {
  const t = convexTest(schema);
  const asUser = await asAllowedUser(t);
  const res = await asUser.query(api.prompts.search, {});
  expect(res.rows).toEqual([]);
  expect(res).toHaveProperty("pageSize");
});
