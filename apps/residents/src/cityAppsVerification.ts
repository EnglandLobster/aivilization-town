import type { OpenSocietyRuntime } from '@aivilization/worker';

/** Explicit test tasks, never injected in free activity mode. */
export function cityAppsVerificationTask(runtime: OpenSocietyRuntime, actorId: string): string {
  const first = runtime.manifest.residents[0]?.id === actorId;
  return `这是城市应用基础设施链路验收，不是自由活动实验。请从上下文 publicServices 的 index 入口开始读取，先运行 town wiki 并按需阅读应用页，使用 town files read 阅读该目录和你要使用的应用 README。${
    first
      ? '请选择商店发布空间，发布一篇你自己写的开店想法，明确只是计划、没有实际成立企业。通过 town apps publish 写入，给出你自己的标题和关联地点 ID。再通过 town apps list 找到它并读取原文。'
      : '先用 town apps list 查找另一名居民已经发布的商店介绍，读取他的完整原文。再到居民评价空间阅读指南，发布一篇自己的回应或提问，明确没有消费过，不编造体验。用 relatedTo 关联那篇文档的 ID，并通过 town apps list 找到自己的帖子。'
  }
正文由你自己决定，CLI 不会替你摘要或改写。不要改写别人或平台的文档。最后简短汇报你真正读过和写过的内容即可。`;
}
export function verifyCityAppsChain(runtime: OpenSocietyRuntime) {
  const citizens = runtime.manifest.residents.map((resident) => resident.id);
  const posts = Object.values(runtime.state.information.documents).filter(
    (doc) =>
      citizens.includes(doc.authorId) &&
      doc.spaceId.startsWith('app-') &&
      doc.path.startsWith('posts/') &&
      !doc.deleted,
  );
  const actors = citizens.map((actorId) => {
    const commits = runtime.journal.commits.filter(
      (commit) => commit.actorId === actorId && commit.result.ok,
    );
    const reads = commits
      .filter((commit) => commit.capability === 'files.read')
      .map((commit) => commit.result.data);
    const hasRead = (predicate: (data: Record<string, unknown>) => boolean) =>
      reads.some(
        (data) =>
          data !== null && typeof data === 'object' && predicate(data as Record<string, unknown>),
      );
    return {
      actorId,
      indexed: commits.some((commit) => commit.capability === 'files.index'),
      readDirectory: hasRead(
        (data) => data.spaceId === 'city-directory' && data.path === 'index.md',
      ),
      readGuide: hasRead((data) => data.path === 'README.md'),
      published: posts.some((doc) => doc.authorId === actorId),
      readPeer: hasRead(
        (data) =>
          typeof data.authorId === 'string' &&
          citizens.includes(data.authorId) &&
          data.authorId !== actorId,
      ),
    };
  });
  return {
    mode: 'city-apps-verification',
    passed:
      actors.length >= 2 &&
      actors.every(
        (actor) => actor.indexed && actor.readDirectory && actor.readGuide && actor.published,
      ) &&
      actors.some((actor) => actor.readPeer),
    appCount: runtime.state.cityApps?.apps.length ?? 0,
    postCount: posts.length,
    actors,
  };
}
