# Frontend on Vercel, backend stack on a single Azure VM

The Next.js PWA deploys to Vercel. Everything else — nginx gateway, three API replicas, Postgres,
and the k6 lab — runs as one Docker Compose stack on a single Azure VM, behind Caddy for TLS on the
free `*.cloudapp.azure.com` hostname.

## Considered Options

Managed container platforms (Azure Container Apps) would give us replica scaling from the provider,
but the setup cost is an hour we do not have and it moves the replica story into a vendor console
where we cannot demonstrate it. Serving the frontend from the compose stack too would keep everything
same-origin and avoid CORS entirely, which is genuinely simpler — we chose Vercel anyway for its CDN
and push-to-deploy, accepting the two costs below.

## Consequences

Splitting origins forces two things that would otherwise be optional. The API **must** terminate TLS,
because a Vercel HTTPS page cannot call an HTTP backend — browsers block it as mixed content, silently.
And the JWT travels in an `Authorization: Bearer` header rather than a cookie, because cross-site
cookies need `SameSite=None; Secure` and more debugging than the header approach costs.

The deploy path is proven with a skeleton early rather than with the finished app late, so that a
broken deployment is discovered when there is time to fix it.
