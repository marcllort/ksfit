# Deploying Stride on your home network (`treadmill.home`)

A step-by-step runbook for serving the dashboard **only on your home LAN**, at
`https://treadmill.home`, with **trusted local HTTPS** (no browser warnings),
on a **UniFi** network.

**Threat model:** this app auto-logs-in with your KS Fit credentials and has
**no login gate** in that mode — anyone who can reach it sees your data. So the
entire plan is: reachable on the LAN, never on the WAN.

---

## 0. Build & run the container

One image runs **two processes**: the Next.js web app (`:3000`) and the Hono
backend API (`:3001`). Caddy splits the front door — `/api/*` → backend,
everything else → web.

```bash
# Credentials live in apps/web/.env.local (gitignored). Generate a token key:
#   openssl rand -hex 32   → add to apps/web/.env.local as TOKEN_ENC_KEY=...
docker compose up --build -d
```

Both ports bind to `127.0.0.1` only (see `docker-compose.yml`) — **not**
reachable from the LAN yet. Caddy (below) is what exposes it, with TLS.

Verify loopback-bound and both processes live:

```bash
ss -ltnp | grep -E '3000|3001'          # both on 127.0.0.1
curl -s localhost:3001/healthz          # backend → {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000   # web → 200
```

---

## 1. Give the host a fixed IP (UniFi)

UniFi Network → **Client Devices** → select the Docker host → Settings →
enable **Fixed IP**, e.g. `192.168.1.10` (pick one outside your DHCP pool).
This anchors the DNS record below.

## 2. Add a local DNS record (UniFi)

UniFi Network → **Settings → Routing & Security** (newer firmware: **Networks →
… → DNS**) → **Local DNS Records** → add:

| Type | Hostname         | Value          |
| ---- | ---------------- | -------------- |
| A    | `treadmill.home` | `192.168.1.10` |

Make sure clients use the UniFi gateway as their DNS server (the default). Then
from any LAN device:

```bash
nslookup treadmill.home     # -> 192.168.1.10
```

> No **Local DNS Records** option on your firmware? Use the gateway's
> host-override / dnsmasq section, or point it at a Pi-hole with the same A
> record.

## 3. Install Caddy on the host

Debian/Ubuntu:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

(Arch: `pacman -S caddy`. macOS host: `brew install caddy`.)

## 4. Use the bundled Caddyfile

A ready `Caddyfile` lives at the repo root — it splits `/api` → backend and
the rest → web:

```caddyfile
treadmill.home {
	tls internal
	encode zstd gzip
	handle_path /api/* { reverse_proxy 127.0.0.1:3001 }
	handle           { reverse_proxy 127.0.0.1:3000 }
}
```

Install and start it:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy now listens on the host's 80/443, auto-redirects HTTP→HTTPS, mints a cert
for `treadmill.home` from its **internal CA**, and proxies to the container.

## 5. Open only 80/443 on the host firewall (if any)

```bash
sudo ufw allow 80,443/tcp
# Do NOT open 3000/3001 — they are loopback-only and must stay that way.
```

## 6. Trust the local CA on your devices (one-time)

This is what removes the certificate warning. Caddy's root CA lives at:

```
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

- **Linux:** `sudo cp root.crt /usr/local/share/ca-certificates/caddy-local.crt && sudo update-ca-certificates`
- **macOS:** double-click `root.crt` → Keychain Access → set to *Always Trust*.
- **iOS:** AirDrop/email the `root.crt`, install the profile (Settings → General
  → VPN & Device Management), then **Settings → General → About → Certificate
  Trust Settings** and enable it.
- **Android:** Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate.

> Prefer `mkcert`? `mkcert -install && mkcert treadmill.home`, then replace the
> Caddyfile's `tls internal` line with `tls ./treadmill.home.pem ./treadmill.home-key.pem`.

## 7. Lock the perimeter (UniFi)

- **Port Forwarding:** confirm there is **no** rule sending 80/443/3000/3001 to the
  host. (There should be none.)
- **Disable UPnP** (Settings → Internet/Network) so nothing self-publishes.
- Do **not** create a public DNS record for this hostname.
- Want access away from home? Use a **VPN** (UniFi Teleport / WireGuard), never
  a port-forward.

## 8. Done

Browse to **https://treadmill.home** from any device on the LAN — green padlock,
no warnings, your real data.

---

## Optional: run Caddy as a sibling container instead

If you'd rather not install Caddy on the host, use the `proxy` profile in
`docker-compose.yml` (drops the app's published port so it's reachable only via
Caddy on the compose network):

```bash
docker compose --profile proxy up --build -d
```

Set the host's LAN IP in the compose `caddy` service's `ports:` (e.g.
`192.168.1.10:443:443`). The `caddy_data` volume persists the internal CA root
across restarts, so you only trust it once.
