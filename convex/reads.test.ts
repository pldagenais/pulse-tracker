import { convexTest } from "convex-test";
import { expect, test, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

beforeEach(() => {
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
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
  const asUser = t.withIdentity({ nickname: "pldagenais" });
  expect(await asUser.query(api.snapshots.get, { key: "projects" })).toEqual([
    { id: 1, name: "Pulse" },
  ]);
});

test("a signed-in but non-allow-listed user is refused", async () => {
  const t = convexTest(schema);
  await seedSnapshot(t);
  const asOther = t.withIdentity({ nickname: "intruder" });
  await expect(asOther.query(api.snapshots.get, { key: "projects" })).rejects.toThrow(
    /not permitted/i,
  );
});

test("missing snapshot returns null rather than throwing", async () => {
  const t = convexTest(schema);
  const asUser = t.withIdentity({ nickname: "pldagenais" });
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
  const asUser = t.withIdentity({ nickname: "pldagenais" });
  expect(await asUser.query(api.sessions.list, {})).toEqual([{ id: "new" }, { id: "old" }]);
});
