# Deploy — Azure VM + Caddy TLS

Target: the whole compose stack (Postgres, 3 API replicas, nginx gateway, Caddy) on one Azure VM,
reachable over HTTPS at a free `*.cloudapp.azure.com` hostname. Frontend deploys separately to Vercel.

**Do this with a skeleton, early.** A deploy proven at 11:50 costs 30 minutes; the same deploy
attempted at 14:00 with the finished app costs an hour you do not have.

Why TLS is not optional: a Vercel HTTPS page cannot call an HTTP API — browsers block it as mixed
content, and they do it **silently**. See `docs/adr/0007`.

---

## 1. Provision (~10 min)

Run locally. Requires the Azure CLI (`az`) and an active student subscription.

```bash
az login

RG=pstu-money
LOC=southeastasia          # closest region to Bangladesh
VM=pstu-money-vm
DNS=pstu-money-$RANDOM     # must be globally unique within the region

az group create --name $RG --location $LOC

az vm create \
  --resource-group $RG \
  --name $VM \
  --image Ubuntu2204 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --public-ip-address-dns-name $DNS

az vm open-port --resource-group $RG --name $VM --port 80  --priority 1001
az vm open-port --resource-group $RG --name $VM --port 443 --priority 1002

# The hostname Caddy will get a certificate for — save it.
az vm show -d --resource-group $RG --name $VM --query fqdns -o tsv
```

**Size note:** `Standard_B2s` (2 vCPU / 4 GB) is the right call. The free-tier `B1s` has 1 GB, and
Postgres plus three API replicas plus two proxies will OOM on it. B2s runs roughly $30/month against
the $100 student credit — a few hours of hackathon is pennies. **Delete the resource group when
you're done** (`az group delete --name pstu-money --yes`) so the credit isn't drained by an idle VM.

## 2. Install Docker on the VM (~5 min)

```bash
ssh azureuser@<the-fqdn-from-above>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker azureuser
exit          # log out and back in for the group to take effect
```

## 3. Deploy (~10 min)

```bash
ssh azureuser@<fqdn>

git clone https://github.com/Rockstatata/pstu-hackathon.git
cd pstu-hackathon

cat > .env <<'ENVFILE'
POSTGRES_USER=money
POSTGRES_PASSWORD=<generate a real one>
POSTGRES_DB=money
JWT_SECRET=<generate a real one>
PUBLIC_HOSTNAME=<fqdn>
ACME_EMAIL=<your email>
CORS_ORIGINS=https://<your-vercel-app>.vercel.app
ENVFILE

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Generate secrets with `openssl rand -base64 24`. Do not commit `.env`.

## 4. Verify (~5 min)

```bash
curl https://<fqdn>/api/v1/health/live          # 200, and a valid cert
curl https://<fqdn>/api/v1/health/ready         # 200, including a database check
curl -sI https://<fqdn>/api/v1/health/live | grep -i x-served-by   # proves nginx is in the path
```

Then, from a browser on a phone, open `https://<fqdn>/api/v1/health/live`. If the padlock is clean, the
Vercel frontend will be able to call it.

Caddy obtains the certificate on first request and it can take ~30s. If it fails, check
`docker compose -f docker-compose.prod.yml logs caddy` — the usual causes are port 80 not open
(Let's Encrypt validates over HTTP) or `PUBLIC_HOSTNAME` not matching the actual FQDN.

## 5. Vercel

Point the frontend at the API and let Vercel auto-deploy on push:

```
NEXT_PUBLIC_API_BASE = https://<fqdn>/api/v1
```

Then set `CORS_ORIGINS` on the VM to the resulting Vercel origin and restart the API:

```bash
docker compose -f docker-compose.prod.yml up -d api
```

**The CORS config must allow the `Idempotency-Key` and `Authorization` request headers, and expose
`X-Served-By` in responses.** Browsers strip non-simple headers otherwise, and the failure looks like
a mysterious network error rather than a CORS problem.

## Redeploying

Every subsequent deploy is two minutes:

```bash
ssh azureuser@<fqdn> 'cd pstu-hackathon && git pull && docker compose -f docker-compose.prod.yml up -d --build'
```

## Demo notes

- Kill a replica live: `docker compose -f docker-compose.prod.yml kill --signal=SIGKILL <container>`,
  then show the integrity endpoint still green. Compose restarts it (`restart: unless-stopped`).
- `docker compose -f docker-compose.prod.yml ps` on the projector shows all three API replicas.
- The k6 lab runs from a laptop against the public URL, or on the VM itself for lower latency noise.
