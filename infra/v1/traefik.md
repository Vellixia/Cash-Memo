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

## Forwarded client addresses

Cashmemo never trusts `X-Forwarded-For` merely because it exists. The API uses the TCP peer from
Axum `ConnectInfo`. An untrusted direct peer is the client and its forwarding header is ignored.
Only a direct peer in `CASHMEMO_V1_TRUSTED_PROXY_CIDRS` activates right-to-left forwarding-chain
resolution. Empty configuration trusts nobody. Production Dokploy Compose requires an explicit
nonempty value: the exact Traefik address CIDR on `CASHMEMO_V1_DOKPLOY_NETWORK`, plus every
approved upstream proxy CIDR that can appear in the trusted right-hand suffix. Do not use a public
client range or a broader host/network range.

Dokploy owns the external Traefik process, so service labels cannot set entrypoint static options.
`x-traefik-static-arguments` in `dokploy-compose.yml` is the exact operator contract to apply to
that managed process:

```text
--entryPoints.websecure.forwardedHeaders.insecure=false
--entryPoints.websecure.forwardedHeaders.notAppendXForwardedFor=false
--entryPoints.websecure.forwardedHeaders.trustedIPs=<approved LB/CDN CIDRs, or empty>
--entryPoints.websecure.http.maxHeaderBytes=8192
```

`notAppendXForwardedFor=false` is Traefik's safe-append mode: it appends the connection's actual
remote address to `X-Forwarded-For`. Therefore an untrusted client's supplied value can remain only
as a left prefix; Rust establishes the appended untrusted client from the right and stops before
parsing that prefix. `insecure=false` prevents universal trust. Keep `trustedIPs` empty for direct
internet ingress; set `CASHMEMO_V1_TRAEFIK_TRUSTED_FORWARDER_CIDRS` only to exact approved
load-balancer/CDN source CIDRs. Traefik documents these entrypoint controls at
<https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/>.

`http.maxHeaderBytes=8192` makes Traefik reject an oversized request-header block before Rust.
Rust independently caps the complete `X-Forwarded-For` field at 8192 bytes, inspects at most the
rightmost 2048 bytes and 16 hops, and returns `400 INVALID_FORWARDING_METADATA` before the auth
handler when a trusted peer supplies no valid untrusted client within those bounds.

Before route activation, render Compose with `infra/v1/test-dokploy-compose.sh`, inspect the
running managed Traefik command/static configuration for all four arguments, and send topology
probes through the public entrypoint. Two distinct public clients must reach distinct limiter
buckets; a client-supplied left prefix must not change either effective client. The
`x-traefik-static-arguments` extension is operator metadata and does not itself mutate Dokploy.

API middleware returns `Cache-Control: no-store`. Web keeps private application and deletion pages
under `private, no-store, max-age=0, must-revalidate`. Proxy/CDN configuration must preserve these
headers and must not cache authenticated content.

Do not publish PostgreSQL or attach it to the edge network. Verify router priority and TLS in
Dokploy preview before route activation; route activation itself is outside this Compose file.
