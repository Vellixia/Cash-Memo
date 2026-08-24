export const AUTHENTICATED_CACHE_CONTROL = "no-store";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createNoStoreFetch(fetcher: FetchLike = fetch): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cache-control", AUTHENTICATED_CACHE_CONTROL);
    headers.set("pragma", "no-cache");
    return fetcher(input, { ...init, cache: "no-store", headers });
  };
}
