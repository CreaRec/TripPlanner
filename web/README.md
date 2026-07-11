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

2. Copy the snippets from [`deploy/nginx/`](../deploy/nginx/) to `/etc/nginx/snippets/`:
   - `trip-planner-static.conf` — replace `__APP_DIR__` with the deploy directory (default `/home/crearec/crea-trip-planner`). Static files still need a host checkout or copy of `web/` under that path (CI does not sync `web/`; copy manually when pages change).
   - `trip-planner-oauth.conf` — replace `__HTTP_PORT__` with the bot HTTP port (default `3000`; Compose publishes `127.0.0.1:$HTTP_PORT:3000`).

3. Inside your HTTPS `server { }`, add:

   ```nginx
   include /etc/nginx/snippets/crea-trip-planner-static.conf;
   include /etc/nginx/snippets/crea-trip-planner-oauth.conf;
   ```

4. Test and reload:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. Open the three URLs above in a browser and confirm they load over HTTPS.

The snippet only defines `location /trip-planner/`; it does not set `listen` or `server_name`. You keep control of TLS and vhost configuration.

See [`docs/docker.md`](../docs/docker.md) for production Compose / GHCR deployment.

## Customize before production

Edit the HTML under [`trip-planner/`](trip-planner/):

- Home: replace `YOUR_BOT_USERNAME` in the Telegram link
- Privacy / Terms: replace `you@example.com` and jurisdiction placeholder text

## Local preview

From the repo root, any static file server rooted at `web/trip-planner` with URL prefix `/trip-planner/` works. Example with Python (visit `http://127.0.0.1:8080/` as `/trip-planner/` paths won’t match without a reverse proxy — simplest check is opening the HTML files directly or using nginx locally).
