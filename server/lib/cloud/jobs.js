// Claims jobs queued from the remote UI and runs them through the existing
// local job runner. Remote runs are forced to read-only permissions: nobody
// is at the keyboard to approve a file write.
// anyApi keeps this file out of Convex's TypeScript graph (see cloud/sync.js).
import { anyApi as api } from 'convex/server';
import { CLOUD_KEY } from '../../config.js';
import { log } from '../logger.js';

const POLL_MS = 10_000;
const WATCH_MS = 3_000;

/**
 * @param {import('convex/browser').ConvexHttpClient} client
 * @param {{ jobs: any, db: import('node:sqlite').DatabaseSync }} deps
 */
export function createQueuePoller(client, { jobs, db }) {
  let timer = null;
  let busy = false;

  const update = (id, patch) =>
    client.mutation(api.jobs.update, { agentKey: CLOUD_KEY, id, ...patch }).catch(() => {});

  /** Mirror a local job's progress back to the cloud until it finishes. */
  function watchLocalJob(cloudId, localJobId) {
    const watch = setInterval(async () => {
      const row = /** @type {any} */ (db
        .prepare('SELECT status, output_tail FROM pulse_jobs WHERE id=?')
        .get(localJobId));
      if (!row) return;
      await update(cloudId, {
        status: row.status === 'running' ? 'running' : row.status,
        outputTail: String(row.output_tail ?? '').slice(-4000),
      });
      if (row.status !== 'running') clearInterval(watch);
    }, WATCH_MS);
    watch.unref();
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const job = await client.mutation(api.jobs.claimNext, { agentKey: CLOUD_KEY });
      if (!job) return;
      log.info(`cloud job ${job._id}: claimed (${job.kind})`);

      if (job.kind === 'run') {
        const project = /** @type {any} */ (db
          .prepare('SELECT id, path FROM projects WHERE id=?')
          .get(Number(job.payload?.projectId)));
        if (!project) throw new Error('unknown project');
        const { jobId, sessionId } = jobs.launch({
          projectId: project.id,
          projectPath: project.path,
          prompt: String(job.payload?.prompt ?? ''),
          model: job.payload?.model ?? null,
          maxTurns: Number(job.payload?.maxTurns) || 15,
          permissionMode: 'default', // remote runs stay read-only by policy
        });
        await update(job._id, { localJobId: jobId, sessionId: sessionId ?? undefined });
        watchLocalJob(job._id, jobId);
      } else if (job.kind === 'kill') {
        jobs.kill(Number(job.payload?.jobId));
        await update(job._id, { status: 'done' });
      } else {
        await update(job._id, { status: 'error', error: `unsupported kind ${job.kind}` });
      }
    } catch (e) {
      log.warn('cloud job poll failed:', e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      timer = setInterval(tick, POLL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
