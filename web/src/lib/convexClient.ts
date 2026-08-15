// Cloud-mode data access. In local mode nothing here is ever constructed.
import { ConvexReactClient } from 'convex/react';
import type { FunctionReference } from 'convex/server';
import { anyApi } from 'convex/server';
import { resolveRemote } from './source';

/** Thrown for capabilities that physically require the local machine. */
export class UnavailableRemotely extends Error {
  constructor(path: string) {
    super(`Not available remotely — ${path} needs your PC. Open Pulse on your machine.`);
    this.name = 'UnavailableRemotely';
  }
}

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

export const convex = url ? new ConvexReactClient(url) : null;

/** "snapshots:get" → anyApi.snapshots.get */
function fnRef(name: string) {
  const [mod, fn] = name.split(':');
  return (anyApi as Record<string, Record<string, unknown>>)[mod][fn] as FunctionReference<'query'>;
}

/**
 * Serve a local REST request from Convex. Reads map to mirrored snapshots or
 * queries; the only writes cloud mode allows are queued commands, which the
 * local agent picks up and executes.
 */
export async function callRemote(path: string, method: string, body?: unknown): Promise<unknown> {
  if (!convex) throw new UnavailableRemotely(path);

  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const enqueue = anyApi.jobs.enqueue as FunctionReference<'mutation'>;
    if (method === 'POST' && path === '/api/jobs') {
      return convex.mutation(enqueue, { kind: 'run', payload: body });
    }
    const kill = path.match(/^\/api\/jobs\/(\d+)\/kill$/);
    if (kill) {
      return convex.mutation(enqueue, { kind: 'kill', payload: { jobId: Number(kill[1]) } });
    }
    throw new UnavailableRemotely(path);
  }

  const call = resolveRemote(path);
  if (!call) throw new UnavailableRemotely(path);
  return convex.query(fnRef(call.fn), call.args);
}
