import type { OpenSocietyRuntime } from '@aivilization/worker';

/** Explicit prompted acceptance; these tasks are never used in free mode. */
export function distributionVerificationTask(runtime: OpenSocietyRuntime, actorId: string): string {
  const [reader, publisher, downstream] = runtime.manifest.residents.map((resident) => resident.id);
  if (
    reader === undefined ||
    publisher === undefined ||
    downstream === undefined ||
    runtime.state.distribution === undefined
  )
    throw new Error('distribution-verification-needs-three-residents-and-enabled-feature');
  const prefix =
    '这是明确指定的传播能力链路验收，不是自由活动或自然涌现证明。只用 town CLI，先按需读 town wiki social/index.md。正文和评价由你自己写，不伪造消费经历。';
  const prior = Object.values(runtime.state.turns).some(
    (turn) => turn.actorId === actorId && turn.status !== 'running',
  );
  if (actorId === reader)
    return (
      prefix +
      (prior
        ? `查询自己的通知，用 notifications read 读取 ${publisher} 发布的原文并确认已读。然后通过 feed share 转发其中一篇真实原文的实际 revision，附上你自己的原话。再次查询未读验证，并结束本次机会。`
        : `通过 subscriptions follow 关注作者 ${publisher}。查询一次 notifications list，尚无内容就如实结束，不需要制造帖子或推进时间。`)
    );
  if (actorId === publisher)
    return (
      prefix +
      (prior
        ? '查询你自己的订阅/通知，查看之前发布的原文。可以如实简短汇报，不需要重复发布或修改。'
        : '使用 town apps publish 在 community 频道发布一篇你自己的原文，话题自由。保留作者元数据，发布后读回验证。')
    );
  if (actorId === downstream)
    return (
      prefix +
      (prior
        ? `查看通知，读取并确认 ${reader} 转发的动态。分别辨认原文作者、转发者和各自的原话，查询未读确认已读，不改写其他人的内容。`
        : `通过 subscriptions follow 关注作者 ${reader}，然后查看通知并结束本次机会。`)
    );
  return prefix + '查看自己的通知即可。';
}

export function verifyDistributionChain(runtime: OpenSocietyRuntime) {
  const [reader, publisher, downstream] = runtime.manifest.residents.map((resident) => resident.id);
  const state = runtime.state.distribution;
  if (
    reader === undefined ||
    publisher === undefined ||
    downstream === undefined ||
    state === undefined
  )
    return {
      mode: 'distribution-verification',
      passed: false,
      error: 'needs-three-residents-and-enabled-feature',
    };
  const originals = Object.values(state.publications).filter(
    (publication) => publication.publisherId === publisher && publication.kind === 'published',
  );
  const shares = Object.values(state.publications).filter(
    (publication) =>
      publication.publisherId === reader &&
      publication.kind === 'shared' &&
      originals.some(
        (source) =>
          source.documentId === publication.documentId &&
          source.documentRevision === publication.documentRevision,
      ),
  );
  const checks = {
    readerFollowedPublisher: state.subscriptions[reader]?.[`author:${publisher}`]?.active === true,
    downstreamFollowedReader:
      state.subscriptions[downstream]?.[`author:${reader}`]?.active === true,
    originalPublished: originals.length > 0,
    readerAcknowledgedOriginal: originals.some((source) =>
      Object.hasOwn(state.readByOwner[reader] ?? {}, source.id),
    ),
    originalShared: shares.length > 0,
    downstreamAcknowledgedShare: shares.some((share) =>
      Object.hasOwn(state.readByOwner[downstream] ?? {}, share.id),
    ),
  };
  return {
    mode: 'distribution-verification',
    passed: Object.values(checks).every(Boolean),
    checks,
    publications: Object.values(state.publications).map((publication) => ({
      id: publication.id,
      publisherId: publication.publisherId,
      documentId: publication.documentId,
      documentRevision: publication.documentRevision,
      kind: publication.kind,
    })),
  };
}
