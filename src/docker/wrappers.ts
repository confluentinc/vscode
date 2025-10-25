/** Interference-free stubbable wrapper around global fetch() */
export function containerFetch(
  input: string | URL | globalThis.Request,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}
