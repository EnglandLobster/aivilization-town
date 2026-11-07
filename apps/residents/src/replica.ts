import { residentAuthorityOrigin, residentAuthorityUrl } from './authorityEndpoint';
import {
  SocietyCommitReplica,
  type OpenSocietyManifest,
  type SocietyCommitPage,
} from '@aivilization/worker';
/** Operator-only trusted authority pull. This token must never be given to a resident driver. */
export async function syncSocietyReplica(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly root: string;
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
}) {
  const maxPages = input.maxPages ?? 16;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1024)
    throw Error('invalid-replica-page-budget');
  const endpoint = residentAuthorityOrigin(input.endpoint);
  const request = async (path: string): Promise<unknown> => {
    const response = await fetch(residentAuthorityUrl(endpoint, path), {
      headers: { authorization: `Bearer ${input.token}` },
      redirect: 'error',
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`replica-authority-http-${response.status}`);
    return response.json();
  };
  // Trusted transport boundary; journal validates schema, manifest policies and world hash.
  const manifest = (await request('/admin/replication/manifest')) as OpenSocietyManifest;
  const replica = new SocietyCommitReplica(input.root, manifest);
  try {
    let pages = 0;
    for (; pages < maxPages; pages++) {
      const before = replica.cursor;
      const query = new URLSearchParams({ sequence: String(before.sequence), hash: before.hash });
      const page = (await request(`/admin/replication/commits?${query}`)) as SocietyCommitPage;
      const after = replica.receive(page);
      if (after.sequence === before.sequence)
        return { status: 'caught-up' as const, cursor: after, pages: pages + 1 };
    }
    return { status: 'page-budget' as const, cursor: replica.cursor, pages };
  } finally {
    replica.close();
  }
}
