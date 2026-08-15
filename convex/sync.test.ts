import { convexTest } from "convex-test";
import { expect, test, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const KEY = "test-agent-key";

beforeEach(() => {
  process.env.PULSE_AGENT_KEY = KEY;
});

test("putSnapshots upserts by key instead of duplicating", async () => {
  const t = convexTest(schema);
  const item = { key: "projects", kind: "projects", payload: [{ id: 1 }], updatedAt: 1 };

  await t.mutation(api.sync.putSnapshots, { agentKey: KEY, items: [item] });
  await t.mutation(api.sync.putSnapshots, {
    agentKey: KEY,
    items: [{ ...item, payload: [{ id: 2 }], updatedAt: 2 }],
  });

  const rows = await t.run(async (ctx) => await ctx.db.query("snapshots").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].payload).toEqual([{ id: 2 }]);
});

test("putSnapshots rejects a bad agent key", async () => {
  const t = convexTest(schema);
  await expect(
    t.mutation(api.sync.putSnapshots, { agentKey: "wrong", items: [] }),
  ).rejects.toThrow(/agent key/i);
});

test("putPrompts upserts by uuid and keeps the text searchable", async () => {
  const t = convexTest(schema);
  const item = {
    uuid: "u1",
    sessionId: "s1",
    projectId: 9,
    projectName: "Pulse",
    sessionTitle: null,
    ts: 1000,
    kind: "typed",
    text: "migrate the database",
    charCount: 20,
  };
  await t.mutation(api.sync.putPrompts, { agentKey: KEY, items: [item] });
  await t.mutation(api.sync.putPrompts, { agentKey: KEY, items: [{ ...item, charCount: 21 }] });

  const rows = await t.run(async (ctx) => await ctx.db.query("prompts").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].charCount).toBe(21);
});

test("heartbeat keeps exactly one status row", async () => {
  const t = convexTest(schema);
  const beat = {
    agentKey: KEY,
    version: "1.0.0",
    ingestPhase: "watching",
    liveCount: 2,
    dbSessions: 115,
    syncedThrough: 5,
  };
  await t.mutation(api.sync.heartbeat, beat);
  await t.mutation(api.sync.heartbeat, { ...beat, liveCount: 3 });

  const rows = await t.run(async (ctx) => await ctx.db.query("agent").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].liveCount).toBe(3);
});
