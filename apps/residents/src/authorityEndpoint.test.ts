import { afterEach, expect, test, vi } from 'vitest';
import { residentAuthorityOrigin, residentAuthorityUrl } from './authorityEndpoint';
import { townConnectionFromEnvironment, townRequest } from './townConnection';
import { resolveResidentListener } from './residentListener';
afterEach(() => vi.unstubAllEnvs());
test('one origin policy retains loopback HTTP and supports remote HTTPS without userinfo or base paths', () => {
  for (const origin of [
    'http://127.0.0.1:4320',
    'http://[::1]:4320',
    'http://localhost:4320',
    'https://authority.example:4320',
  ])
    expect(residentAuthorityOrigin(origin + '/')).toBe(origin);
  for (const origin of [
    'http://10.0.0.2:4320',
    'http://127.example:4320',
    'https://user:secret@authority.example',
    'https://authority.example/api',
    'https://authority.example/?secret=1',
    'https://authority.example/#secret',
    'file:///tmp/world',
  ])
    expect(() => residentAuthorityOrigin(origin)).toThrow();
  for (const path of ['//other.example', 'https://other.example', '/\\other.example', '/context\n'])
    expect(() => residentAuthorityUrl('https://authority.example', path)).toThrow('request-path');
  expect(residentAuthorityUrl('https://authority.example', '/context').origin).toBe(
    'https://authority.example',
  );
});
test('environment and transport validate the same origin before credentials leave the process', async () => {
  vi.stubEnv('TOWN_ENDPOINT', 'https://authority.example');
  vi.stubEnv('TOWN_RESIDENT_TOKEN', 'actor-token');
  expect(townConnectionFromEnvironment()).toEqual({
    endpoint: 'https://authority.example',
    token: 'actor-token',
  });
  vi.stubEnv('TOWN_ENDPOINT', 'http://authority.example');
  expect(() => townConnectionFromEnvironment()).toThrow('insecure');
  await expect(
    townRequest({ endpoint: 'http://authority.example', token: 'private' }, '/context'),
  ).rejects.toThrow('insecure');
});
test('listener defaults stay local and invalid remote listener settings are rejected', () => {
  expect(resolveResidentListener({})).toEqual({
    host: '127.0.0.1',
    protocol: 'http',
    advertised: '127.0.0.1',
  });
  expect(() => resolveResidentListener({ host: '0.0.0.0' })).toThrow('requires-tls');
  expect(() =>
    resolveResidentListener({ host: '127.0.0.1', advertiseHost: 'authority.example' }),
  ).toThrow('requires-tls');
  expect(() => resolveResidentListener({ host: 'https://authority.example' })).toThrow(
    'listen-host',
  );
  expect(() => resolveResidentListener({ tls: { key: 'invalid', cert: 'invalid' } })).toThrow();
});

test('a redirect cannot forward the authority credential to another listener', async () => {
  const { createServer } = await import('node:http');
  let received = false;
  const target = createServer((_request, response) => {
    received = true;
    response.end('{}');
  });
  const redirect = createServer((_request, response) => {
    const address = target.address();
    if (!address || typeof address === 'string') throw Error('missing-test-address');
    response.writeHead(302, { location: `http://127.0.0.1:${address.port}/context` });
    response.end();
  });
  const listen = (server: typeof target) =>
    new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = (server: typeof target) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await listen(target);
  await listen(redirect);
  try {
    const address = redirect.address();
    if (!address || typeof address === 'string') throw Error('missing-test-address');
    await expect(
      townRequest({ endpoint: `http://127.0.0.1:${address.port}`, token: 'private' }, '/context'),
    ).rejects.toThrow();
    expect(received).toBe(false);
  } finally {
    await close(redirect);
    await close(target);
  }
});
