// The API worker's service binding (see alchemy.run.ts), for server-side
// calls from this worker. server.ts hands it over on each request; it is the
// same object for every request in an isolate. Without it (`vp dev` on its
// own, or tests), calls go out over the network to VITE_SERVER_URL instead.

type ServiceBinding = { fetch: (request: Request) => Promise<Response> };

let binding: ServiceBinding | null = null;

export function setServerBinding(next: ServiceBinding | undefined) {
  binding = next ?? null;
}

/** Fetches an API URL, straight through the binding when there is one. */
export function fetchServer(url: string, init?: RequestInit) {
  return binding ? binding.fetch(new Request(url, init)) : fetch(url, init);
}
