# Cashmemo V1 same-origin routing

Dokploy attaches `cashmemo-v1-web` and `cashmemo-v1-api` to its external Traefik network. Two
routers share one host:

- Priority `100`: `Host(CASHMEMO_V1_HOST) && (Path(/api/v1) || PathPrefix(/api/v1/))` routes the
  exact API namespace to API port `3000`; `/api/v10` remains a web route.
- Priority `1`: `Host(CASHMEMO_V1_HOST)` routes every remaining path to web port `3000`.

Because API joins edge and private networks, `traefik.docker.network` explicitly selects
`CASHMEMO_V1_DOKPLOY_NETWORK`. PostgreSQL remains reachable only on the stable
`CASHMEMO_V1_PRIVATE_NETWORK` name.

No API path rewrite occurs. Browser calls remain relative `/api/v1/*` requests under
`CASHMEMO_V1_PUBLIC_ORIGIN`; API derives unsafe-request origin policy from that exact origin.
Traefik terminates TLS. `CASHMEMO_V1_COOKIE_SECURE=true` is mandatory in production.

API middleware returns `Cache-Control: no-store`. Web keeps private application and deletion pages
under `private, no-store, max-age=0, must-revalidate`. Proxy/CDN configuration must preserve these
headers and must not cache authenticated content.

Do not publish PostgreSQL or attach it to the edge network. Verify router priority and TLS in
Dokploy preview before route activation; route activation itself is outside this Compose file.
