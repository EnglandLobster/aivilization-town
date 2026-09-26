import {
  CITY_APPS,
  CITY_APPS_VERSION,
  CITY_DIRECTORY_SPACE,
  CITY_SERVICES_AUTHOR,
  cityAppGuide,
  cityDirectoryText,
} from '@aivilization/content';
import {
  applyInformationEvent,
  decideInformationCommand,
  type InformationCommand,
  type InformationEvent,
} from '@aivilization/information';
import type { CityAppDirectory, OpenSocietyManifest, OpenSocietyState } from './types';

/** Preflight all commands on a private immutable state, then commit the full installation once. */
export function prepareCityAppInstallation(state: OpenSocietyState, manifest: OpenSocietyManifest) {
  let information = state.information;
  const informationEvents: InformationEvent[] = [];
  const execute = (command: InformationCommand) => {
    const decision = decideInformationCommand({
      state: information,
      actorId: CITY_SERVICES_AUTHOR,
      at: state.world.clock.now,
      command,
      policy: manifest.informationPolicy,
      agentExists: (id) => id === CITY_SERVICES_AUTHOR || Object.hasOwn(state.world.agents, id),
    });
    if (!decision.accepted) throw new Error(`city-app-install-conflict:${decision.reason}`);
    information = decision.events.reduce(applyInformationEvent, information);
    informationEvents.push(...decision.events);
  };
  execute({
    type: 'space.create',
    id: CITY_DIRECTORY_SPACE,
    title: '城市应用入口',
    visibility: 'public',
    posting: 'owner',
    members: [],
  });
  execute({
    type: 'file.create',
    spaceId: CITY_DIRECTORY_SPACE,
    path: 'index.md',
    title: '城市公共应用与基础设施索引',
    content: cityDirectoryText(),
    tags: ['基础设施', '入口'],
  });
  for (const app of CITY_APPS)
    for (const channel of app.channels) {
      execute({
        type: 'space.create',
        id: channel.spaceId,
        title: channel.title,
        visibility: 'public',
        posting: 'everyone',
        members: [],
      });
      execute({
        type: 'file.create',
        spaceId: channel.spaceId,
        path: 'README.md',
        title: `${channel.title} · 使用说明`,
        content: cityAppGuide(app, channel),
        tags: ['基础设施', '说明'],
      });
      execute({
        type: 'file.create',
        spaceId: channel.spaceId,
        path: 'TEMPLATE.md',
        title: `${channel.title} · 可选空模板`,
        content: `# 可选空模板\n\n这是一份空模板，不是居民投稿或已发生的事情。可以自由修改格式，在 posts/ 下新建你自己的文档。\n\n${channel.template}\n`,
        tags: ['基础设施', '空模板'],
      });
    }
  const directory: CityAppDirectory = {
    version: CITY_APPS_VERSION,
    index: { spaceId: CITY_DIRECTORY_SPACE, path: 'index.md' },
    apps: CITY_APPS.map((app) => ({
      id: app.id,
      title: app.title,
      description: app.description,
      channels: app.channels.map((channel) => ({
        spaceId: channel.spaceId,
        title: channel.title,
        guidePath: 'README.md',
      })),
    })),
  };
  return { informationEvents, cityApps: directory };
}
