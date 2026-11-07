import { createSecureContext } from 'node:tls';
import { isIP } from 'node:net';
import { isResidentLoopbackHost } from './authorityEndpoint';
export type ResidentListenerOptions = {
  readonly host?: string;
  readonly advertiseHost?: string;
  readonly tls?: { readonly key: string | Buffer; readonly cert: string | Buffer };
};
function validHost(value: string) {
  return (
    !!isIP(value) ||
    (value.length <= 253 &&
      value
        .split('.')
        .every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))
  );
}
export function resolveResidentListener(options: ResidentListenerOptions) {
  if (options.tls) createSecureContext(options.tls);
  const host = options.host ?? '127.0.0.1';
  if (!validHost(host)) throw Error('invalid-resident-listen-host');
  if (!options.tls && !isResidentLoopbackHost(host))
    throw Error('remote-resident-listener-requires-tls');
  const advertised =
    options.advertiseHost ?? (host === '0.0.0.0' || host === '::' ? undefined : host);
  if (!advertised || !validHost(advertised) || advertised === '0.0.0.0' || advertised === '::')
    throw Error('resident-advertise-host-required');
  if (!options.tls && !isResidentLoopbackHost(advertised))
    throw Error('remote-resident-listener-requires-tls');
  return {
    host,
    protocol: options.tls ? 'https' : 'http',
    advertised: isIP(advertised) === 6 ? `[${advertised}]` : advertised,
  };
}
