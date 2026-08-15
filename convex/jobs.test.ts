import { convexTest } from "convex-test";
import { expect, test, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { asAllowedUser, TEST_EMAIL } from "./lib/testUser";

const KEY = "k";

beforeEach(() => {
  process.env.PULSE_AGENT_KEY = KEY;
  process.env.ALLOWED_USERS = TEST_EMAIL;
});

test("claimNext hands out each queued job exactly once", async () => {
  const t = convexTest(schema);
  const asUser = await asAllowedUser(t);
  await asUser.mutation(api.jobs.enqueue, { kind: "run", payload: { prompt: "hi" } });

  const first = await t.mutation(api.jobs.claimNext, { agentKey: KEY });
  const second = await t.mutation(api.jobs.claimNext, { agentKey: KEY });

  expect(first?.payload).toEqual({ prompt: "hi" });
  expect(first?.status).toBe("running");
  expect(second).toBeNull();
});

test("enqueue requires a signed-in allow-listed user", async () => {
  const t = convexTest(schema);
  await expect(
    t.mutation(api.jobs.enqueue, { kind: "run", payload: {} }),
  ).rejects.toThrow(/not signed in/i);
});

test("list returns local-shaped rows, unclaimed jobs first", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("snapshots", {
      key: "jobs",
      kind: "status",
      payload: { jobs: [{ id: 3, prompt: "already ran", status: "done" }], running: 1 },
      updatedAt: 1,
    });
  });
  const asUser = await asAllowedUser(t);
  await asUser.mutation(api.jobs.enqueue, {
    kind: "run",
    payload: { prompt: "queued remotely", projectId: 9 },
  });

  const res = await asUser.query(api.jobs.list, {});
  // every row must expose `prompt` — the Run page calls .replace() on it
  expect(res.jobs.map((j: any) => j.prompt)).toEqual(["queued remotely", "already ran"]);
  expect((res.jobs[0] as any).status).toBe("queued");
  expect(res.running).toBe(1);
});

test("update records terminal state and finish time", async () => {
  const t = convexTest(schema);
  const asUser = await asAllowedUser(t);
  const id = await asUser.mutation(api.jobs.enqueue, { kind: "run", payload: {} });

  await t.mutation(api.jobs.update, {
    agentKey: KEY,
    id,
    status: "done",
    outputTail: "OK",
  });

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("done");
  expect(row?.outputTail).toBe("OK");
  expect(typeof row?.finishedAt).toBe("number");
});
