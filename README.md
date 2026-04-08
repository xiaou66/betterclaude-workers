# BetterClaude Gateway

An intelligent Claude API proxy that supports Cloudflare Workers, Tencent Cloud EO Pages, and Alibaba Cloud ESA Functions & Pages, and automatically fixes orphaned tool_result errors.

## Features

- **Auto Error Fix**: Automatically detects and removes orphaned `tool_result` blocks that cause 400 errors
- **Proactive Cleanup**: Cleans messages before API calls to prevent errors
- **Smart Retry**: Falls back to reactive cleanup if proactive detection misses edge cases
- **Transparent Proxy**: Preserves all headers and client information
- **Triple Runtime**: Runs on Cloudflare Workers, Tencent Cloud EO Pages, and Alibaba Cloud ESA Functions & Pages
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
- [ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool) and an ESA account with Functions & Pages enabled if you want Alibaba Cloud deployment

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
npx esa-cli dev src/esa.ts --port 8789    # ESA local dev server, after init/login
```

## Configuration

### Environment Variables

- `ALLOWED_TARGET_HOSTS`: Comma-separated upstream host whitelist. If empty, all upstream hosts are allowed.
- `DEBUG_REQUEST_LOGS`: Set to `true` to enable minimal debug logging.

### Cloudflare

Use `wrangler secret put` or `vars`/secrets in your Cloudflare environment.

### EO Pages

Use the EdgeOne CLI or the EO Pages console environment variable settings.

### Alibaba Cloud ESA

ESA reads runtime variables from its own Pages runtime environment. Keep the variable names identical:

- `ALLOWED_TARGET_HOSTS`
- `DEBUG_REQUEST_LOGS`

This repository intentionally uses `npx esa-cli ...` commands from documentation instead of adding ESA-specific scripts into `package.json`.

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

## Alibaba Cloud ESA

This repository supports Alibaba Cloud ESA using Functions & Pages with a dedicated [`esa.jsonc`](./esa.jsonc) config and [`src/esa.ts`](./src/esa.ts) runtime entry.

### 1. First-Time Setup

Login and initialize the local ESA project:

```bash
npx esa-cli login
npx esa-cli init
```

The repository does not add ESA CLI commands into `package.json`. Use `npx esa-cli ...` directly.

Before the first production release, configure runtime variables in the ESA Functions & Pages console if you need them:

- `ALLOWED_TARGET_HOSTS`
- `DEBUG_REQUEST_LOGS`

### 2. Local Development

Start the ESA local dev server on a fixed port:

```bash
npx esa-cli dev src/esa.ts --port 8789
```

Then verify the local endpoints:

```bash
curl -i http://127.0.0.1:8789/
curl -i http://127.0.0.1:8789/health
```

Expected behavior:

- `/` -> `200`
- `/health` -> `200 OK`

### 3. Deployment

Deploy directly from the repository entry file. If the ESA project does not already exist, `deploy` can create it when you pass `-n`:

```bash
npx esa-cli deploy src/esa.ts -e staging -n <your-project-name>
npx esa-cli deploy src/esa.ts -e production -n <your-project-name>
```

If you prefer a manual versioning step first, ESA CLI also supports:

```bash
npx esa-cli commit
npx esa-cli deploy
```

After deployment, inspect the active versions and use the exact public URL printed by the CLI:

```bash
npx esa-cli deployments list
```

Then verify the public endpoints:

```bash
curl -i "<ESA_DEPLOY_URL>/"
curl -i "<ESA_DEPLOY_URL>/health"
```

Expected behavior:

- `/` -> `200`
- `/health` -> `200 OK`

### 4. Custom Domain

If you want a stable production domain, bind a custom domain in ESA and then verify it directly:

```bash
npx esa-cli domain add <your-domain>
npx esa-cli domain list
curl -i https://<your-domain>/
curl -i https://<your-domain>/health
```

Expected behavior:

- `/` -> `200`
- `/health` -> `200 OK`

### 5. Troubleshooting

Default ESA domain returns `582 Version retrieval failed` right after deploy:

- This usually means the ESA default domain has resolved but the new version is not fully attached yet.
- Wait a short time and retry:

```bash
curl -i "<ESA_DEPLOY_URL>/"
curl -i "<ESA_DEPLOY_URL>/health"
```

- If the problem persists, check `npx esa-cli deployments list` again and confirm the expected version is `Active` in the target environment.

`ALLOWED_TARGET_HOSTS` is unset:

- This is valid on ESA.
- The gateway allows all upstream hosts by default.
- Only configure `ALLOWED_TARGET_HOSTS` when you want to explicitly restrict target hosts.

### 6. Important ESA Constraint

Do not use ESA route bypass mode for this gateway.

Reason:

- This gateway needs the full request body for `/claude/{host}/v1/messages`
- This gateway must preserve its own response semantics for `/`, `/health`, invalid routes, and proxy responses
- ESA bypass mode does not match this project’s request/response model

Use ESA Pages with a direct bound domain instead, so `/`, `/health`, and `/claude/...` are all handled by the function entry itself.

## Project Structure

```text
betterclaude-workers/
├── src/
│   ├── core/                     # Shared proxy, cleanup, retry, routing logic
│   ├── adapters/
│   │   ├── cloudflare/           # Cloudflare request/context adapter
│   │   ├── edgeone/              # EO request/context adapter
│   │   └── esa/                  # ESA request/context adapter
│   ├── esa.ts                    # ESA entry point
│   ├── index.ts                  # Cloudflare entry point
│   └── env.d.ts                  # Environment type definitions
├── cloud-functions/              # EO Pages function entry files
├── esa.jsonc                     # ESA Pages configuration
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
