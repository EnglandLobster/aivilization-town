import { isIP } from 'node:net';
export function isResidentLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.'))
  );
}
/** A credential-bearing authority origin, shared by residents, compute workers and replicas. */
export function residentAuthorityOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !isResidentLoopbackHost(url.hostname))
  )
    throw Error('invalid-or-insecure-authority-origin');
  return url.origin;
}
export function residentAuthorityUrl(endpoint: string, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path))
    throw Error('invalid-authority-request-path');
  return new URL(path, residentAuthorityOrigin(endpoint));
}
