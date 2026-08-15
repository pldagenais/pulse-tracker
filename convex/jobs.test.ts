import { convexTest } from "convex-test";
import { expect, test, beforeEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const KEY = "k";

beforeEach(() => {
  process.env.PULSE_AGENT_KEY = KEY;
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
});

test("claimNext hands out each queued job exactly once", async () => {
  const t = convexTest(schema);
  const asUser = t.withIdentity({ nickname: "pldagenais" });
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

test("update records terminal state and finish time", async () => {
  const t = convexTest(schema);
  const asUser = t.withIdentity({ nickname: "pldagenais" });
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
