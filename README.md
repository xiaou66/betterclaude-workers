# BetterClaude Gateway

An intelligent Claude API proxy that supports both Cloudflare Workers and Tencent Cloud EO Pages, and automatically fixes orphaned tool_result errors.

## Features

- **Auto Error Fix**: Automatically detects and removes orphaned `tool_result` blocks that cause 400 errors
- **Proactive Cleanup**: Cleans messages before API calls to prevent errors
- **Smart Retry**: Falls back to reactive cleanup if proactive detection misses edge cases
- **Transparent Proxy**: Preserves all headers and client information
- **Dual Runtime**: Runs on both Cloudflare Workers and Tencent Cloud EO Pages
- **Target Whitelist**: Restricts upstream hosts through `ALLOWED_TARGET_HOSTS`

## The Problem

When using Claude with tools, the message history can become corrupted with orphaned `tool_result` blocks - results that reference `tool_use` calls that no longer exist in the conversation. This causes Claude API to return 400 errors:

```
tool_result block(s) that reference non-existent tool_use ids
```

BetterClaude automatically detects and removes these orphaned blocks, allowing the conversation to continue.

## How It Works

1. **Proactive Detection**: Before making the API call, scans messages for orphaned `tool_result` blocks and removes them
2. **API Call**: Forwards the cleaned request to the target Claude API
3. **Reactive Fallback**: If a 400 error still occurs, parses the error to identify remaining orphans and retries once

### Architecture

![BetterClaude Architecture](static/architecture.png)

## Usage

Prefix your Claude API endpoint with the gateway URL:

```
https://<YOUR_DOMAIN>/claude/<TARGET_HOST>/v1/messages
```

### Examples

**Direct Anthropic API:**
```
https://api.anthropic.com/v1/messages
→ https://<YOUR_DOMAIN>/claude/api.anthropic.com/v1/messages
```

**Third-party Claude API providers:**
```
https://some-provider.com/v1/messages
→ https://<YOUR_DOMAIN>/claude/some-provider.com/v1/messages
```

## Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Cloudflare account](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [EdgeOne CLI](https://www.npmjs.com/package/edgeone) and EO Pages project access if you want Tencent Cloud deployment

### Install

1. Clone and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd betterclaude-workers
   npm install
   ```

2. Optionally configure `ALLOWED_TARGET_HOSTS` if you want to restrict which upstream hosts can be proxied.

### Cloudflare Workers

1. Configure `wrangler.jsonc`:
   - Set your worker name
   - Add your domain routes

2. Configure environment variables if needed:
   ```bash
   wrangler secret put ALLOWED_TARGET_HOSTS
   wrangler secret put DEBUG_REQUEST_LOGS
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

### Development

```bash
npm run dev:cf    # Cloudflare local dev server at http://localhost:8787/
npx edgeone pages dev    # EO Pages local dev server, after pages init/login
```

## Configuration

### Environment Variables

- `ALLOWED_TARGET_HOSTS`: Comma-separated upstream host whitelist. If empty, all upstream hosts are allowed.
- `DEBUG_REQUEST_LOGS`: Set to `true` to enable minimal debug logging.

### Cloudflare

Use `wrangler secret put` or `vars`/secrets in your Cloudflare environment.

### EO Pages

Use the EdgeOne CLI or the EO Pages console environment variable settings.

### `wrangler.jsonc`

```jsonc
{
  "name": "your-worker-name",
  "main": "src/index.ts",
  "compatibility_date": "2025-12-13",
  "routes": [
    {
      "pattern": "<YOUR_DOMAIN>/*",
      "zone_name": "<YOUR_ZONE>"
    }
  ]
}
```

## EO Pages

Current EO CLI initialization for this repository uses `cloud-functions/` as the functions root.

### 1. First-Time Setup

Login and initialize the local Pages project:

```bash
npx edgeone login
npx edgeone pages init
```

If the EO Pages project already exists in the console, link the current repository to it:

```bash
npx edgeone pages link
```

After linking, confirm that `.edgeone/project.json` points to the correct project.

### 2. Configure EO Environment Variables

Set variables only if you actually need them:

```bash
npx edgeone pages env set DEBUG_REQUEST_LOGS true
npx edgeone pages env set ALLOWED_TARGET_HOSTS api.anthropic.com,example-provider.com
npx edgeone pages env ls
```

Notes:

- `ALLOWED_TARGET_HOSTS` is optional. If you do not set it, the gateway allows all upstream hosts.
- Configure `ALLOWED_TARGET_HOSTS` only when you want to explicitly restrict upstream targets.
- `DEBUG_REQUEST_LOGS=true` is optional and useful only for debugging.

### 3. Local Development

Run the EO local dev server:

```bash
npx edgeone pages dev
```

Then test the local health endpoint:

```bash
curl http://127.0.0.1:8088/health
```

### 4. Preview Deployment

Deploy a preview build:

```bash
npx edgeone pages deploy -e preview -n <your-project-name>
```

Important preview behavior:

- EO preview URLs are protected.
- The generated preview link contains `eo_token` and `eo_time`.
- If you open the bare preview URL without those parameters or without the preview cookies, EO may return `401` with messages like `eo_time missing`.
- Open the full preview link once first, or use the cookies it sets for follow-up requests.

### 5. Production Deployment

Deploy the live version:

```bash
npx edgeone pages deploy -e production -n <your-project-name>
```

The CLI will print the final deployment URL. If you have a custom domain bound to the project, production traffic will use that domain.

### 6. Custom Domain

Bind your domain in the EO Pages console to the production environment, then verify it directly:

```bash
curl -i https://<your-domain>/
curl -i https://<your-domain>/health
```

Expected results:

- `/` returns `200` with the info message
- `/health` returns `200 OK`

### 7. Deployment Verification Checklist

After each EO production deploy, verify at least these endpoints:

```bash
curl -i https://<your-domain>/
curl -i https://<your-domain>/health
curl -i https://<your-domain>/claude/example.com/foo
```

Expected behavior:

- `/` -> `200`
- `/health` -> `200`
- invalid proxy path such as `/claude/example.com/foo` -> `403`

### 8. Troubleshooting

`401` on preview URL:

- You are probably visiting the preview deployment without the required `eo_token` and `eo_time` query parameters or preview cookies.

`500 script error` on `/` or `/health`:

- Check whether EO unexpectedly generated `.edgeone/edge-functions/index.js`.
- In this project, the correct runtime output should only use `cloud-functions/`.
- If you migrated from an older template, remove obsolete root-level middleware/proxy entry files such as `src/proxy.ts` or `src/middleware.ts`, then rebuild and redeploy.

`[cli]No environment variables found.` during deploy:

- This is not fatal by itself.
- It only means no EO console variables were synced into the deployment.
- If `ALLOWED_TARGET_HOSTS` is intentionally unset, the gateway still works and allows all upstream hosts by default.

## Project Structure

```text
betterclaude-workers/
├── src/
│   ├── core/                     # Shared proxy, cleanup, retry, routing logic
│   ├── adapters/
│   │   ├── cloudflare/           # Cloudflare request/context adapter
│   │   └── edgeone/              # EO request/context adapter
│   ├── index.ts                  # Cloudflare entry point
│   └── env.d.ts                  # Environment type definitions
├── cloud-functions/              # EO Pages function entry files
├── tests/                        # Vitest coverage for shared core and adapters
├── wrangler.jsonc                # Cloudflare Worker configuration
├── tsconfig.json                 # TypeScript configuration
├── vitest.config.ts              # Test configuration
└── package.json                  # Dependencies and scripts
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Info endpoint |
| `/health` | Health check |
| `/claude/{host}/{path}` | Proxy to Claude API |

## How the Cleanup Works

The orphan detection algorithm:

1. **Build tool_use index**: Scans all messages to find all `tool_use` blocks and their IDs
2. **Find orphans**: Identifies `tool_result` blocks that reference non-existent `tool_use` IDs
3. **Remove orphans**: Filters out orphaned `tool_result` blocks from messages
4. **Clean empty messages**: Removes user messages that become empty after cleanup

## License

MIT
