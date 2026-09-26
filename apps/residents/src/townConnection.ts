export type TownConnection = { readonly endpoint: string; readonly token: string };
export function townConnectionFromEnvironment(): TownConnection {
  const endpoint = process.env.TOWN_ENDPOINT;
  const token = process.env.TOWN_RESIDENT_TOKEN;
  if (
    endpoint === undefined ||
    token === undefined ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)
  )
    throw new Error('missing-or-invalid-town-connection');
  return { endpoint, token };
}
export async function townRequest(
  connection: TownConnection,
  path: string,
  value?: unknown,
): Promise<unknown> {
  const response = await fetch(`${connection.endpoint}${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(`town-http-${response.status}`);
  return result;
}
