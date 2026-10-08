# Memora

Memora is a private personal memory and life timeline app backed by Supabase.

## Included

- Email and password authentication
- Row Level Security per user
- Personal memory capture
- Object location history
- Ask Memora retrieval
- Memories and timeline views
- People, places and things
- Private document uploads
- Connections screen
- JSON export
- PWA basics

## Cloudflare v43.1

Cloudflare work lives on `cloudflare-v43-fixes`. The Vercel v42 production branch and `api/` handlers are unchanged. Do not merge this branch into `main` to publish to Cloudflare.

Use Node.js 22 or newer:

```bash
npm ci
npm test
npm run build
npm run dev
```

Open the local URL printed by Wrangler. A plain static server cannot run the `/api/` routes. The build bundles the browser dependencies locally, hashes the JavaScript and CSS filenames, and publishes only public assets into `dist/`.

The npm `prepare` lifecycle also creates `dist/` during dependency installation, so a Pages project with an existing empty build command can still prepare the assets. The explicit build settings below are recommended. `.node-version` selects Node.js 22 for Pages.

In the existing Cloudflare Pages project `memora`, use these Git build settings:

| Setting | Value |
| --- | --- |
| Production branch | `cloudflare-v43-fixes` |
| Framework preset | None |
| Root directory | Repository root |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22 or newer |

`wrangler.jsonc` defines the Pages output directory and runtime compatibility date. The `functions/` directory remains at the repository root and supplies `/api/ask`, `/api/audio-library`, `/api/open-music`, `/api/scene-background`, `/api/health`, and a JSON 404 for unknown API paths.

For a direct upload from an authenticated Cloudflare CLI session:

```bash
npm run deploy:cloudflare
```

This command targets only the `memora` Pages project and the Cloudflare branch. It is a preview deployment until that branch is selected as the Pages production branch. Check the deployment URL and `/api/health` after publishing; the health response must report `version: "43.1"` and `runtime: "cloudflare-pages"`.

## AI and sign-in configuration

Email/password and magic-link sign-in use the existing Supabase project. OAuth buttons appear only for providers enabled in Supabase. Add the Cloudflare production origin and any intended preview origin to Supabase Auth's redirect URL allowlist before using OAuth or email links there.

Ask Memora verifies the caller's Supabase session and reads data through that session's Row Level Security policies. It uses the user's connected provider through the existing `ai-provider-proxy` Edge Function. A server-only `AI_GATEWAY_API_KEY` Cloudflare secret can optionally enable the AI Gateway route. `AUDIUS_API_KEY` is optional for the open music catalog. The deployed Vercel OIDC token is not used by the Cloudflare worker. Never place these secrets in the frontend or commit them.

Catalog availability and playable radio streams depend on their upstream services. Playback supports HTTP range requests, bounded recovery, and explicit catalog errors. Authenticated data and API/audio responses are excluded from the service worker's cache.

## Security

The frontend contains only the Supabase publishable key. Never put a service role key or database password in this repository.

All user data access is protected by Supabase Row Level Security.
