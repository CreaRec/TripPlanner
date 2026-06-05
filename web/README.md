# Crea Trip Planner — static web pages

Public HTML for Google OAuth consent screen **App domain** fields and similar disclosures. This folder is isolated from the Telegram bot (`src/`); nginx serves the files directly.

## URLs (Google Cloud Console)

Replace `<your-domain>` with the hostname that terminates HTTPS for your app (same domain you register in Google OAuth).

| Google field | URL |
| --- | --- |
| Application home page | `https://<your-domain>/trip-planner/` |
| Application privacy policy link | `https://<your-domain>/trip-planner/privacy/` |
| Application terms of service link | `https://<your-domain>/trip-planner/terms/` |

## One-time nginx setup

1. Ensure nginx is installed and you have an HTTPS `server { }` block for `<your-domain>`.

2. Deploy the project at least once so the snippet exists on the server (see below), or copy [`deploy/nginx/trip-planner-static.conf`](../deploy/nginx/trip-planner-static.conf) manually with `__APP_DIR__` replaced by your app directory (default `/home/crearec/crea-trip-planner`).

3. Inside your HTTPS `server { }`, add:

   ```nginx
   include /etc/nginx/snippets/crea-trip-planner-static.conf;
   ```

4. Test and reload:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. Open the three URLs above in a browser and confirm they load over HTTPS.

The snippet only defines `location /trip-planner/`; it does not set `listen` or `server_name`. You keep control of TLS and vhost configuration.

## Deploy automation

[`scripts/deploy.sh`](../scripts/deploy.sh) rsyncs `web/` to the server on every deploy and, by default:

- Verifies `web/trip-planner/index.html`, `privacy/index.html`, and `terms/index.html` exist on the server
- Installs `/etc/nginx/snippets/crea-trip-planner-static.conf` with `REMOTE_APP_DIR` substituted for `__APP_DIR__`
- Runs `nginx -t` and reloads nginx when nginx is available (warnings only on failure; the bot deploy still completes)

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `REMOTE_APP_DIR` | `/home/crearec/crea-trip-planner` | App root; used in the nginx `alias` path |
| `SKIP_NGINX_WEB` | unset | Set to `1` to skip snippet install and nginx reload |

## Customize before production

Edit the HTML under [`trip-planner/`](trip-planner/):

- Home: replace `YOUR_BOT_USERNAME` in the Telegram link
- Privacy / Terms: replace `you@example.com` and jurisdiction placeholder text

## Local preview

From the repo root, any static file server rooted at `web/trip-planner` with URL prefix `/trip-planner/` works. Example with Python (visit `http://127.0.0.1:8080/` as `/trip-planner/` paths won’t match without a reverse proxy — simplest check is opening the HTML files directly or using nginx locally).
