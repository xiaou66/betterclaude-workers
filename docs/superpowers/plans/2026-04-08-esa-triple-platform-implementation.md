# ESA Triple-Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Alibaba Cloud ESA Functions & Pages support to this repository while keeping runtime behavior identical to Cloudflare Workers and Tencent Cloud EO Pages.

**Architecture:** Reuse the existing `src/core/*` request pipeline unchanged and add a thin ESA adapter plus an ESA-specific entry file and `esa.jsonc` deployment config. Keep deployment behavior platform-specific in documentation and config only; do not add ESA CLI scripts to `package.json`.

**Tech Stack:** TypeScript, standard Fetch API (`Request` / `Response` / `Headers` / `fetch`), Vitest, Cloudflare Workers, EdgeOne Pages, Alibaba Cloud ESA Functions & Pages

---

**Repo rule note:** Do not add git commit or branch steps to this plan. The repository instructions explicitly forbid planning git commits unless the user asks for them.

## File Structure Map

### Create

- `src/adapters/esa/context.ts`
  - Normalize ESA request/environment data into the shared `AppContext`.
- `src/adapters/esa/entry.ts`
  - Bridge ESA requests into `handleRequest(...)` with the shared proxy implementation.
- `src/esa.ts`
  - Provide the ESA runtime entry using the standard `export default { fetch(...) }` shape.
- `tests/adapters/esa.entry.test.ts`
  - Cover the ESA adapter with the same style already used for EO and Cloudflare adapter tests.
- `esa.jsonc`
  - Declare the ESA Pages entry file and minimal install/build behavior.

### Modify

- `src/core/types.ts`
  - Extend the platform union to include `'esa'`.
- `src/env.d.ts`
  - Update the comments to describe shared runtime environment variables across all three platforms.
- `README.md`
  - Expand documentation from dual-platform to triple-platform support and add ESA `init / dev / commit / deploy / domain` guidance.

### Intentionally Unchanged

- `src/core/app.ts`
- `src/core/proxy.ts`
- `src/core/retry-handler.ts`
- `src/core/proactive-cleanup.ts`
- `src/core/error-detector.ts`
- `src/core/routes.ts`
- `src/index.ts`
- `package.json`

Rationale:

- Shared proxy behavior is already verified in the current dual-platform architecture.
- The user explicitly chose to keep deployment config platform-specific and to avoid adding ESA CLI scripts into `package.json`.

## Task 1: Add a Failing ESA Adapter Test

**Files:**
- Create: `tests/adapters/esa.entry.test.ts`
- Test: `tests/adapters/esa.entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/esa.entry.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest';
import { handleEsaRequest } from '../../src/adapters/esa/entry';

describe('handleEsaRequest', () => {
	it('maps ESA request and env to AppContext and serves health endpoint', async () => {
		const response = await handleEsaRequest(new Request('https://gateway.example.com/health'), {
			ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npx vitest run tests/adapters/esa.entry.test.ts
```

Expected:

- The run fails because `../../src/adapters/esa/entry` does not exist yet.

## Task 2: Implement the ESA Adapter and Runtime Entry

**Files:**
- Create: `src/adapters/esa/context.ts`
- Create: `src/adapters/esa/entry.ts`
- Create: `src/esa.ts`
- Modify: `src/core/types.ts`
- Modify: `src/env.d.ts`
- Test: `tests/adapters/esa.entry.test.ts`

- [ ] **Step 1: Extend the shared platform type**

Update `src/core/types.ts` to include `'esa'`:

```ts
export interface AppContext {
	request: Request;
	platform: 'cloudflare' | 'edgeone' | 'esa';
	env: Record<string, string | undefined>;
	waitUntil?: (promise: Promise<unknown>) => void;
}

export interface RouteInfo {
	targetHost: string;
	targetPath: string;
	searchParams: string;
}

export interface AppDependencies {
	proxyRequest: (request: Request, route: RouteInfo) => Promise<Response>;
}
```

- [ ] **Step 2: Update the shared env comment to reflect all three runtimes**

Replace the comment in `src/env.d.ts` with:

```ts
/**
 * Shared runtime environment variable names.
 * Cloudflare reads them from Wrangler-provided bindings.
 * EdgeOne and ESA read equivalent string values from their own runtime environment.
 */
declare global {
	interface Env {
		ALLOWED_TARGET_HOSTS?: string;
		DEBUG_REQUEST_LOGS?: string;
	}
}

export {};
```

- [ ] **Step 3: Add the ESA context adapter**

Create `src/adapters/esa/context.ts`:

```ts
import type { AppContext } from '../../core/types';

export interface EsaRequestOptions {
	waitUntil?: (promise: Promise<unknown>) => void;
}

export function createEsaAppContext(
	request: Request,
	env: Record<string, string | undefined>,
	options: EsaRequestOptions = {}
): AppContext {
	return {
		request,
		platform: 'esa',
		env,
		waitUntil: options.waitUntil,
	};
}
```

- [ ] **Step 4: Add the ESA entry adapter**

Create `src/adapters/esa/entry.ts`:

```ts
import { handleRequest } from '../../core/app';
import { proxyRequest } from '../../core/proxy';
import { createEsaAppContext, type EsaRequestOptions } from './context';

export async function handleEsaRequest(
	request: Request,
	env: Record<string, string | undefined>,
	options: EsaRequestOptions = {}
): Promise<Response> {
	return handleRequest(createEsaAppContext(request, env, options), {
		proxyRequest,
	});
}
```

- [ ] **Step 5: Add the ESA runtime entry**

Create `src/esa.ts`:

```ts
import { handleEsaRequest } from './adapters/esa/entry';

function readEsaEnv(): Record<string, string | undefined> {
	const processLike = globalThis as typeof globalThis & {
		process?: {
			env?: Record<string, unknown>;
		};
	};

	return Object.fromEntries(
		Object.entries(processLike.process?.env ?? {}).filter(([, value]) => typeof value === 'string')
	) as Record<string, string | undefined>;
}

export default {
	async fetch(request: Request): Promise<Response> {
		try {
			return await handleEsaRequest(request, readEsaEnv());
		} catch {
			return new Response('Bad Gateway', {
				status: 502,
				headers: { 'Content-Type': 'text/plain' },
			});
		}
	},
};
```

- [ ] **Step 6: Re-run the targeted ESA adapter test**

Run:

```bash
npx vitest run tests/adapters/esa.entry.test.ts
```

Expected:

- The test passes.

- [ ] **Step 7: Run the full automated verification suite**

Run:

```bash
npm run test
npm run typecheck
```

Expected:

- All existing Vitest suites pass.
- TypeScript typecheck passes without adding ESA-specific runtime errors.

## Task 3: Add ESA Pages Configuration

**Files:**
- Create: `esa.jsonc`

- [ ] **Step 1: Add a minimal ESA Pages config**

Create `esa.jsonc` at the repository root:

```jsonc
{
	"name": "betterclaude-workers",
	"entry": "./src/esa.ts",
	"installCommand": "npm install",
	"buildCommand": ""
}
```

Reasoning:

- `entry` points directly to the new ESA runtime file.
- `installCommand` keeps ESA consistent with the existing repository workflow.
- `buildCommand` is intentionally empty because this project is a pure runtime gateway and does not need a frontend build step.

- [ ] **Step 2: Dry-run the config shape through the TypeScript/ESA path**

Run:

```bash
npm run typecheck
```

Expected:

- No TypeScript changes are needed after adding `esa.jsonc`.

## Task 4: Document ESA Local Development and Deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the top-level product description to triple-platform wording**

Update the opening lines in `README.md` so the intro reads:

```md
# BetterClaude Gateway

An intelligent Claude API proxy that supports Cloudflare Workers, Tencent Cloud EO Pages, and Alibaba Cloud ESA Functions & Pages, and automatically fixes orphaned tool_result errors.
```

Update the features list to replace dual-platform wording with triple-platform wording:

```md
- **Triple Runtime**: Runs on Cloudflare Workers, Tencent Cloud EO Pages, and Alibaba Cloud ESA Functions & Pages
```

- [ ] **Step 2: Add ESA prerequisites and deployment guidance**

Add the ESA CLI prerequisite to the deployment section:

```md
- [ESA CLI](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool) and an ESA account with Functions & Pages enabled if you want Alibaba Cloud deployment
```

Add a new `## Alibaba Cloud ESA` section after the EO Pages section with this content:

```md
## Alibaba Cloud ESA

This repository supports Alibaba Cloud ESA using Functions & Pages with a dedicated `esa.jsonc` config and `src/esa.ts` runtime entry.

### 1. First-Time Setup

```bash
npx esa-cli login
npx esa-cli init
```

### 2. Local Development

Run the ESA local dev server on a fixed port:

```bash
npx esa-cli dev --port 8789
```

Then verify the local endpoints:

```bash
curl -i http://127.0.0.1:8789/
curl -i http://127.0.0.1:8789/health
```

Expected behavior:

- `/` -> `200`
- `/health` -> `200 OK`

### 3. Version Commit and Deployment

```bash
npx esa-cli commit
npx esa-cli deploy
```

After `deploy`, use the exact public URL printed by the CLI to verify `/` and `/health`.

### 4. Custom Domain

Bind a real domain you control:

```bash
npx esa-cli domain list
```

If no domain is bound yet, add one:

```bash
read -r ESA_DOMAIN
npx esa-cli domain add "$ESA_DOMAIN"
```

Then verify:

```bash
curl -i "https://${ESA_DOMAIN}/"
curl -i "https://${ESA_DOMAIN}/health"
```

### 5. Important ESA Constraint

Do not use ESA route bypass mode for this project.

This gateway needs the full request body and the original upstream status code semantics. Use Pages with a direct domain binding instead.
```

- [ ] **Step 3: Update the project structure section**

Update the structure block in `README.md` so it includes the ESA adapter and config:

```text
betterclaude-workers/
├── src/
│   ├── adapters/
│   │   ├── cloudflare/
│   │   ├── edgeone/
│   │   └── esa/
│   ├── core/
│   ├── env.d.ts
│   ├── esa.ts
│   └── index.ts
├── cloud-functions/
├── esa.jsonc
├── tests/
└── wrangler.jsonc
```

- [ ] **Step 4: Document the ESA troubleshooting rule**

Add this exact troubleshooting note to the README troubleshooting area:

```md
`ESA route bypass mode`:

- Do not use it for this gateway.
- ESA bypass mode does not preserve this project's request/response behavior.
- Keep ESA traffic on the Pages direct-domain path so `/`, `/health`, and `/claude/...` are all handled by the function entry itself.
```

## Task 5: Verify the ESA Workflow End-to-End

**Files:**
- Verify: `src/adapters/esa/context.ts`
- Verify: `src/adapters/esa/entry.ts`
- Verify: `src/esa.ts`
- Verify: `esa.jsonc`
- Verify: `README.md`

- [ ] **Step 1: Re-run the repository test and typecheck gates**

Run:

```bash
npm run test
npm run typecheck
```

Expected:

- All tests pass.
- Typecheck passes.

- [ ] **Step 2: Initialize ESA in the current workspace if it is not already initialized**

Run:

```bash
npx esa-cli init
```

Expected:

- The ESA CLI completes its initialization flow without rejecting `esa.jsonc`.
- The repository is ready for `dev`, `commit`, and `deploy`.

- [ ] **Step 3: Start ESA local development on a fixed port**

Run:

```bash
npx esa-cli dev --port 8789
```

Expected:

- The local ESA server starts successfully.
- The CLI exposes a local URL on port `8789`.

- [ ] **Step 4: Verify the local ESA endpoints**

Run:

```bash
curl -i http://127.0.0.1:8789/
curl -i http://127.0.0.1:8789/health
```

Expected:

- `/` returns `200` and contains `BetterClaude Gateway`
- `/health` returns `200 OK`

- [ ] **Step 5: Create an ESA version and deploy it**

Run:

```bash
npx esa-cli commit
npx esa-cli deploy
```

Expected:

- `commit` creates a version successfully.
- `deploy` activates that version and prints a public URL.

- [ ] **Step 6: Verify the deployed ESA public URL using the exact URL printed by the CLI**

Run these two commands, and when prompted, paste the exact deploy URL that `npx esa-cli deploy` printed:

```bash
read -r ESA_DEPLOY_URL
curl -i "${ESA_DEPLOY_URL%/}/"
curl -i "${ESA_DEPLOY_URL%/}/health"
```

Expected:

- The public URL returns `200`
- The public `/health` endpoint returns `200 OK`

- [ ] **Step 7: Verify one bound ESA custom domain if the project has one**

First list bound domains:

```bash
npx esa-cli domain list
```

If the list already contains the domain for this project, paste that exact domain when prompted and verify it:

```bash
read -r ESA_DOMAIN
curl -i "https://${ESA_DOMAIN}/"
curl -i "https://${ESA_DOMAIN}/health"
```

Expected:

- The custom domain returns `200`
- The custom domain `/health` returns `200 OK`

If the project has no bound domain yet, stop here and follow the README domain-binding steps before claiming full ESA acceptance.
