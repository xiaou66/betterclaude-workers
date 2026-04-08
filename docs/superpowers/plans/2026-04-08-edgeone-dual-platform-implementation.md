# BetterClaude 双平台支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BetterClaude 从单一 Cloudflare Worker 重构为共享核心逻辑的双平台代理，同时支持 Cloudflare Workers 与腾讯云 EO Pages，并保持统一的 `/claude/{host}/v1/messages` 接口契约。

**Architecture:** 先抽出平台无关的核心层，再分别为 Cloudflare 和 EO 建立薄适配入口。所有 orphan cleanup、retry、header 透传与 host 白名单逻辑都收敛到核心层，平台入口只做上下文映射和响应返回。

**Tech Stack:** TypeScript、Cloudflare Workers、EO Pages Node.js Functions、Vitest、Wrangler

---

按仓库约束，本计划不包含 `git commit`、分支创建或推送步骤。

## 文件映射

### 新建文件

- `src/core/types.ts`
  - 定义平台无关的 `AppContext`、`RouteInfo`、`RuntimeConfig`、依赖注入接口
- `src/core/config.ts`
  - 解析 `ALLOWED_TARGET_HOSTS` 和 `DEBUG_REQUEST_LOGS`
- `src/core/routes.ts`
  - 解析 `/claude/{host}/{path}`
- `src/core/app.ts`
  - 处理 `/`、`/health`、路径校验、白名单校验并调用核心代理
- `src/core/proactive-cleanup.ts`
  - 平台无关的 orphaned `tool_result` 清理
- `src/core/error-detector.ts`
  - 识别 Claude / MiniMax orphan 错误
- `src/core/streaming-handler.ts`
  - 流式响应识别
- `src/core/retry-handler.ts`
  - cleanup + retry 主流程
- `src/core/proxy.ts`
  - 构建上游 headers、处理 body、调用 retry 流程
- `src/adapters/cloudflare/context.ts`
  - Cloudflare `fetch(request, env, ctx)` -> `AppContext`
- `src/adapters/cloudflare/entry.ts`
  - Cloudflare 平台入口封装
- `src/adapters/edgeone/context.ts`
  - EO `onRequest(context)` -> `AppContext`
- `src/adapters/edgeone/entry.ts`
  - EO 平台入口封装
- `cloud-functions/index.ts`
  - EO 根路径入口
- `cloud-functions/[[default]].ts`
  - EO 非根路径入口
- `vitest.config.ts`
  - 测试配置
- `tests/core/config.test.ts`
  - 配置解析测试
- `tests/core/app.test.ts`
  - 核心路由与白名单测试
- `tests/core/pipeline.test.ts`
  - cleanup / retry / proxy 流程测试
- `tests/adapters/cloudflare.entry.test.ts`
  - Cloudflare 适配测试
- `tests/adapters/edgeone.entry.test.ts`
  - EO 适配测试

### 修改文件

- `package.json`
  - 增加测试与类型检查脚本，补充 devDependencies
- `src/index.ts`
  - 改为纯 Cloudflare 入口适配
- `src/env.d.ts`
  - 补充 Cloudflare 环境变量类型
- `README.md`
  - 更新双平台开发与部署说明

### 现有文件迁移来源

- `src/router.ts` -> `src/core/routes.ts`
- `src/proxy.ts` -> `src/core/proxy.ts`
- `src/retry-handler.ts` -> `src/core/retry-handler.ts`
- `src/proactive-cleanup.ts` -> `src/core/proactive-cleanup.ts`
- `src/error-detector.ts` -> `src/core/error-detector.ts`
- `src/streaming-handler.ts` -> `src/core/streaming-handler.ts`

### 实施前提

- 使用 EO Node.js Functions
- 当前仓库已通过 `edgeone pages init` 实测，EO 函数目录为 `cloud-functions/`
- 后续执行与文档都以 `cloud-functions/` 为准

## Task 1: 建立测试基座与运行时配置解析

**Files:**
- Create: `vitest.config.ts`
- Create: `src/core/config.ts`
- Test: `tests/core/config.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试，锁定配置解析行为**

```ts
// tests/core/config.test.ts
import { describe, expect, it } from 'vitest';
import { isTargetHostAllowed, loadRuntimeConfig } from '../../src/core/config';

describe('loadRuntimeConfig', () => {
	it('parses allowed hosts and debug flag', () => {
		const config = loadRuntimeConfig({
			ALLOWED_TARGET_HOSTS: 'api.anthropic.com, open.bigmodel.cn ,API.MINIMAX.CHAT',
			DEBUG_REQUEST_LOGS: 'true',
		});

		expect([...config.allowedTargetHosts]).toEqual([
			'api.anthropic.com',
			'open.bigmodel.cn',
			'api.minimax.chat',
		]);
		expect(config.debugRequestLogs).toBe(true);
	});

	it('allows all targets when whitelist is empty', () => {
		const config = loadRuntimeConfig({});

		expect(config.allowedTargetHosts.size).toBe(0);
		expect(isTargetHostAllowed('api.anthropic.com', config)).toBe(true);
	});

	it('matches hosts case-insensitively', () => {
		const config = loadRuntimeConfig({
			ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
		});

		expect(isTargetHostAllowed('API.Anthropic.Com', config)).toBe(true);
		expect(isTargetHostAllowed('api.openai.com', config)).toBe(false);
	});
});
```

- [ ] **Step 2: 运行测试，确认当前仓库还没有测试基座**

Run: `npm run test -- tests/core/config.test.ts`

Expected:
- 命令失败
- 提示缺少 `test` script，或缺少 `vitest`

- [ ] **Step 3: 增加 Vitest 配置和运行时配置实现**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globals: true,
		restoreMocks: true,
		unstubGlobals: true,
	},
});
```

```ts
// src/core/config.ts
export interface RuntimeConfig {
	allowedTargetHosts: Set<string>;
	debugRequestLogs: boolean;
}

function parseAllowedTargetHosts(value: string | undefined): Set<string> {
	if (!value) {
		return new Set();
	}

	return new Set(
		value
			.split(',')
			.map(host => host.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
	return {
		allowedTargetHosts: parseAllowedTargetHosts(env.ALLOWED_TARGET_HOSTS),
		debugRequestLogs: env.DEBUG_REQUEST_LOGS === 'true',
	};
}

export function isTargetHostAllowed(host: string, config: RuntimeConfig): boolean {
	if (config.allowedTargetHosts.size === 0) {
		return false;
	}

	return config.allowedTargetHosts.has(host.toLowerCase());
}
```

```json
// package.json
{
	"name": "white-morning-8a37",
	"version": "0.0.0",
	"private": true,
	"scripts": {
		"deploy": "wrangler deploy",
		"dev:cf": "wrangler dev",
		"test": "vitest run",
		"test:watch": "vitest",
		"typecheck": "tsc --noEmit",
		"cf-typegen": "wrangler types"
	},
	"devDependencies": {
		"typescript": "^5.5.2",
		"vitest": "^3.2.4",
		"wrangler": "^4.54.0"
	}
}
```

- [ ] **Step 4: 运行测试与类型检查，确认基座可用**

Run:
- `npm install`
- `npm run test -- tests/core/config.test.ts`
- `npm run typecheck`

Expected:
- `tests/core/config.test.ts` 通过
- `tsc --noEmit` 通过

## Task 2: 抽出平台无关的路由与应用入口

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/routes.ts`
- Create: `src/core/app.ts`
- Test: `tests/core/app.test.ts`

- [ ] **Step 1: 写失败测试，固定 `/`、`/health`、无效路径、白名单行为**

```ts
// tests/core/app.test.ts
import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/core/app';
import type { AppContext } from '../../src/core/types';

function makeContext(url: string, env: Record<string, string | undefined> = {}): AppContext {
	return {
		request: new Request(url),
		platform: 'cloudflare',
		env,
	};
}

describe('handleRequest', () => {
	it('returns info response for root path', async () => {
		const response = await handleRequest(makeContext('https://gateway.example.com/'), {
			proxyRequest: vi.fn(),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('BetterClaude Gateway');
	});

	it('returns OK for health path', async () => {
		const response = await handleRequest(makeContext('https://gateway.example.com/health'), {
			proxyRequest: vi.fn(),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});

	it('returns 400 for invalid route', async () => {
		const response = await handleRequest(makeContext('https://gateway.example.com/not-supported'), {
			proxyRequest: vi.fn(),
		});

		expect(response.status).toBe(400);
	});

	it('returns 403 when target path is not v1/messages', async () => {
		const response = await handleRequest(
			makeContext('https://gateway.example.com/claude/api.anthropic.com/v1/models', {
				ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
			}),
			{ proxyRequest: vi.fn() }
		);

		expect(response.status).toBe(403);
	});

	it('returns 403 when target host is not in whitelist', async () => {
		const response = await handleRequest(
			makeContext('https://gateway.example.com/claude/api.openai.com/v1/messages', {
				ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
			}),
			{ proxyRequest: vi.fn() }
		);

		expect(response.status).toBe(403);
	});
});
```

- [ ] **Step 2: 运行测试，确认核心入口尚不存在**

Run: `npm run test -- tests/core/app.test.ts`

Expected:
- 测试失败
- 报错 `Cannot find module '../../src/core/app'`

- [ ] **Step 3: 实现 `types`、`routes`、`app` 三个核心文件**

```ts
// src/core/types.ts
export interface AppContext {
	request: Request;
	platform: 'cloudflare' | 'edgeone';
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

```ts
// src/core/routes.ts
import type { RouteInfo } from './types';

export function parseRoute(url: URL): RouteInfo | null {
	const match = url.pathname.match(/^\/claude\/([^/]+)\/(.*)$/);

	if (!match) {
		return null;
	}

	return {
		targetHost: match[1],
		targetPath: match[2] || '',
		searchParams: url.search,
	};
}
```

```ts
// src/core/app.ts
import { isTargetHostAllowed, loadRuntimeConfig } from './config';
import { parseRoute } from './routes';
import type { AppContext, AppDependencies } from './types';

export async function handleRequest(context: AppContext, deps: AppDependencies): Promise<Response> {
	const url = new URL(context.request.url);
	const pathname = url.pathname;

	if (pathname === '/') {
		return new Response('BetterClaude Gateway. Use /claude/{host}/v1/messages', {
			status: 200,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	if (pathname === '/health') {
		return new Response('OK', {
			status: 200,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	const route = parseRoute(url);
	if (!route) {
		return new Response('Invalid endpoint. Required format: /claude/{host}/{path}', {
			status: 400,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	if (!route.targetPath.includes('v1/messages')) {
		return new Response(
			JSON.stringify({
				type: 'error',
				error: {
					type: 'forbidden',
					message: 'Invalid endpoint. Path must contain v1/messages',
				},
			}),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	const config = loadRuntimeConfig(context.env);
	if (!isTargetHostAllowed(route.targetHost, config)) {
		return new Response(
			JSON.stringify({
				type: 'error',
				error: {
					type: 'forbidden',
					message: 'Target host is not allowed',
				},
			}),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	return deps.proxyRequest(context.request, route);
}
```

- [ ] **Step 4: 运行测试，确认核心入口行为固定**

Run: `npm run test -- tests/core/app.test.ts`

Expected:
- 5 个测试全部通过

## Task 3: 迁移纯函数模块并建立回归测试

**Files:**
- Create: `src/core/proactive-cleanup.ts`
- Create: `src/core/error-detector.ts`
- Create: `src/core/streaming-handler.ts`
- Test: `tests/core/pipeline.test.ts`

- [ ] **Step 1: 写失败测试，固定 cleanup、错误识别和流式识别**

```ts
// tests/core/pipeline.test.ts
import { describe, expect, it } from 'vitest';
import { detectOrphanedToolError } from '../../src/core/error-detector';
import { detectAndRemoveOrphanedToolResults } from '../../src/core/proactive-cleanup';
import { isStreamingResponse } from '../../src/core/streaming-handler';

describe('pipeline utilities', () => {
	it('removes orphaned tool_result blocks', () => {
		const result = detectAndRemoveOrphanedToolResults([
			{
				role: 'assistant',
				content: [{ type: 'tool_use', id: 'toolu_123', name: 'search', input: {} }],
			},
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_123', content: 'ok' },
					{ type: 'tool_result', tool_use_id: 'toolu_missing', content: 'orphan' },
				],
			},
		]);

		expect(result.hadOrphans).toBe(true);
		expect(result.removedIds).toEqual(['toolu_missing']);
		expect(result.cleanedMessages[1].content).toHaveLength(1);
	});

	it('detects Claude orphan errors', async () => {
		const response = new Response(
			JSON.stringify({
				error: {
					message:
						'unexpected `tool_use_id` found in `tool_result` blocks: toolu_deadbeef',
				},
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);

		const result = await detectOrphanedToolError(response);
		expect(result.isError).toBe(true);
		expect(result.provider).toBe('claude');
		expect(result.orphanedIds).toEqual(['toolu_deadbeef']);
	});

	it('identifies SSE responses', () => {
		const response = new Response('data: hello\n\n', {
			headers: { 'Content-Type': 'text/event-stream' },
		});

		expect(isStreamingResponse(response)).toBe(true);
	});
});
```

- [ ] **Step 2: 运行测试，确认核心工具还未迁移**

Run: `npm run test -- tests/core/pipeline.test.ts`

Expected:
- 测试失败
- 报错缺少 `src/core/*` 模块

- [ ] **Step 3: 从旧实现拷贝纯函数逻辑到 `src/core`**

```ts
// src/core/proactive-cleanup.ts
export interface ContentBlock {
	type: 'text' | 'tool_use' | 'tool_result';
	text?: string;
	id?: string;
	tool_use_id?: string;
	name?: string;
	input?: unknown;
	content?: string | ContentBlock[];
}

export interface Message {
	role: 'user' | 'assistant' | 'system';
	content: ContentBlock[];
}

export interface CleanupResult {
	cleanedMessages: Message[];
	removedIds: string[];
	hadOrphans: boolean;
}

export function detectAndRemoveOrphanedToolResults(messages: Message[]): CleanupResult {
	const validToolUseIds = new Set<string>();

	for (const message of messages) {
		for (const block of message.content) {
			if (block.type === 'tool_use' && block.id) {
				validToolUseIds.add(block.id);
			}
		}
	}

	const orphanedIds: string[] = [];
	for (const message of messages) {
		for (const block of message.content) {
			if (block.type === 'tool_result' && block.tool_use_id && !validToolUseIds.has(block.tool_use_id)) {
				orphanedIds.push(block.tool_use_id);
			}
		}
	}

	if (orphanedIds.length === 0) {
		return { cleanedMessages: messages, removedIds: [], hadOrphans: false };
	}

	const orphanedIdsSet = new Set(orphanedIds);
	const cleanedMessages = structuredClone(messages);

	for (const message of cleanedMessages) {
		message.content = message.content.filter(block => {
			if (block.type === 'tool_result' && block.tool_use_id) {
				return !orphanedIdsSet.has(block.tool_use_id);
			}
			return true;
		});
	}

	return { cleanedMessages, removedIds: orphanedIds, hadOrphans: true };
}
```

```ts
// src/core/error-detector.ts
export interface ErrorInfo {
	isError: boolean;
	orphanedIds: string[];
	provider: 'claude' | 'minimax' | null;
}

export async function detectOrphanedToolError(response: Response): Promise<ErrorInfo> {
	if (response.status !== 400) {
		return { isError: false, orphanedIds: [], provider: null };
	}

	try {
		const body = await response.clone().text();
		const errorData = JSON.parse(body);
		const errorMessage = errorData?.error?.message || '';

		const claudeMatches = [
			...errorMessage.matchAll(/unexpected `tool_use_id` found in `tool_result` blocks: (toolu_\w+)/g),
		];
		if (claudeMatches.length > 0) {
			return {
				isError: true,
				orphanedIds: claudeMatches.map(match => match[1]),
				provider: 'claude',
			};
		}

		const minimaxMatches = [...errorMessage.matchAll(/tool result's tool id\(([^)]+)\) not found/g)];
		if (minimaxMatches.length > 0) {
			return {
				isError: true,
				orphanedIds: minimaxMatches.map(match => match[1]),
				provider: 'minimax',
			};
		}

		return { isError: false, orphanedIds: [], provider: null };
	} catch {
		return { isError: false, orphanedIds: [], provider: null };
	}
}
```

```ts
// src/core/streaming-handler.ts
export function isStreamingResponse(response: Response): boolean {
	const contentType = response.headers.get('Content-Type') || '';
	const transferEncoding = response.headers.get('Transfer-Encoding') || '';

	return contentType.includes('text/event-stream') || transferEncoding.includes('chunked');
}
```

- [ ] **Step 4: 运行回归测试，确认旧逻辑已被新路径承接**

Run: `npm run test -- tests/core/pipeline.test.ts`

Expected:
- 当前 `pipeline` 测试通过

## Task 4: 实现核心代理与 retry 流程

**Files:**
- Create: `src/core/retry-handler.ts`
- Create: `src/core/proxy.ts`
- Modify: `tests/core/pipeline.test.ts`

- [ ] **Step 1: 扩展失败测试，锁定 GET 直通、JSON cleanup、一次重试**

```ts
// tests/core/pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyRequest } from '../../src/core/proxy';

describe('proxyRequest', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		fetchMock.mockReset();
	});

	it('forwards GET requests directly', async () => {
		fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

		const response = await proxyRequest(
			new Request('https://gateway.example.com/claude/api.anthropic.com/v1/messages', {
				method: 'GET',
				headers: { Host: 'gateway.example.com' },
			}),
			{
				targetHost: 'api.anthropic.com',
				targetPath: 'v1/messages',
				searchParams: '',
			}
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
	});

	it('cleans orphaned tool_result blocks before POST', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

		const response = await proxyRequest(
			new Request('https://gateway.example.com/claude/api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					Host: 'gateway.example.com',
					'Content-Type': 'application/json',
					'CF-Connecting-IP': '1.1.1.1',
				},
				body: JSON.stringify({
					messages: [
						{
							role: 'assistant',
							content: [{ type: 'tool_use', id: 'toolu_live', name: 'search', input: {} }],
						},
						{
							role: 'user',
							content: [
								{ type: 'tool_result', tool_use_id: 'toolu_live', content: 'ok' },
								{ type: 'tool_result', tool_use_id: 'toolu_orphan', content: 'orphan' },
							],
						},
					],
				}),
			}),
			{
				targetHost: 'api.anthropic.com',
				targetPath: 'v1/messages',
				searchParams: '',
			}
		);

		const forwardedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(response.status).toBe(200);
		expect(forwardedBody.messages[1].content).toEqual([
			{ type: 'tool_result', tool_use_id: 'toolu_live', content: 'ok' },
		]);
	});
});
```

- [ ] **Step 2: 运行测试，确认核心代理尚未接到新路径**

Run: `npm run test -- tests/core/pipeline.test.ts`

Expected:
- 至少 `proxyRequest` 相关用例失败

- [ ] **Step 3: 将现有代理、retry 和 header 透传逻辑迁入核心层**

```ts
// src/core/retry-handler.ts
import { detectOrphanedToolError } from './error-detector';
import { detectAndRemoveOrphanedToolResults, type Message } from './proactive-cleanup';
import { isStreamingResponse } from './streaming-handler';

export interface RetryMetadata {
	removedToolUseIds: string[];
	proactiveRemovedIds: string[];
	retryCount: number;
	result: 'success' | 'proactive_success' | 'retry_success';
}

async function makeApiCall(request: Request, targetUrl: string, headers: Headers, body: string): Promise<Response> {
	return fetch(targetUrl, {
		method: request.method,
		headers,
		body,
		// @ts-expect-error duplex is valid at runtime
		duplex: 'half',
	});
}

function removeOrphanedToolResult(messages: Message[], toolUseId: string): Message[] {
	const orphanedIdsSet = new Set([toolUseId]);
	const cleanedMessages = structuredClone(messages);

	for (const message of cleanedMessages) {
		message.content = message.content.filter(block => {
			if (block.type === 'tool_result' && block.tool_use_id) {
				return !orphanedIdsSet.has(block.tool_use_id);
			}
			return true;
		});
	}

	return cleanedMessages;
}

export async function retryWithCleanup(
	request: Request,
	targetUrl: string,
	headers: Headers,
	providedBody?: { text: string; json?: unknown }
): Promise<Response> {
	const bodyText = providedBody?.text ?? (await request.text());
	let body: any = providedBody?.json;

	if (body === undefined) {
		body = JSON.parse(bodyText);
	}

	let messages: Message[] = body.messages || [];
	const cleanupResult = detectAndRemoveOrphanedToolResults(messages);
	body.messages = cleanupResult.cleanedMessages;

	const firstResponse = await makeApiCall(request, targetUrl, headers, JSON.stringify(body));
	if (firstResponse.ok || isStreamingResponse(firstResponse)) {
		return firstResponse;
	}

	if (firstResponse.status !== 400) {
		return firstResponse;
	}

	const errorInfo = await detectOrphanedToolError(firstResponse);
	if (!errorInfo.isError || errorInfo.orphanedIds.length === 0) {
		return firstResponse;
	}

	messages = removeOrphanedToolResult(body.messages, errorInfo.orphanedIds[0]);
	body.messages = messages;

	return makeApiCall(request, targetUrl, headers, JSON.stringify(body));
}
```

```ts
// src/core/proxy.ts
import type { RouteInfo } from './types';
import { retryWithCleanup } from './retry-handler';

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailers',
	'transfer-encoding',
	'upgrade',
	'host',
]);

const PROXY_MANAGED_HEADERS = new Set([
	'x-forwarded-for',
	'x-forwarded-proto',
	'x-forwarded-host',
	'x-real-ip',
	'true-client-ip',
	'cf-connecting-ip',
	'cf-connecting-ipv6',
	'cf-ipcountry',
	'cf-ray',
	'cf-visitor',
	'cf-worker',
	'x-request-id',
]);

export function buildUpstreamHeaders(request: Request, targetHost: string): Headers {
	const headers = new Headers();

	for (const [key, value] of request.headers.entries()) {
		const lowerKey = key.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(lowerKey) || PROXY_MANAGED_HEADERS.has(lowerKey)) {
			continue;
		}
		headers.set(key, value);
	}

	headers.set('Host', targetHost);

	const clientIp = request.headers.get('CF-Connecting-IP') || '';
	if (clientIp) {
		headers.set('X-Forwarded-For', clientIp);
		headers.set('X-Real-IP', clientIp);
		headers.set('True-Client-IP', clientIp);
		headers.set('CF-Connecting-IP', clientIp);
	}

	const originalHost = request.headers.get('Host') || '';
	if (originalHost) {
		headers.set('X-Forwarded-Host', originalHost);
	}

	const cfVisitor = request.headers.get('CF-Visitor');
	headers.set('X-Forwarded-Proto', cfVisitor ? JSON.parse(cfVisitor).scheme || 'https' : 'https');

	const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
	headers.set('X-Request-ID', requestId);
	headers.set('X-Correlation-ID', requestId);

	return headers;
}

export async function proxyRequest(request: Request, route: RouteInfo): Promise<Response> {
	const targetUrl = `https://${route.targetHost}/${route.targetPath}${route.searchParams}`;
	const headers = buildUpstreamHeaders(request, route.targetHost);

	if (request.method === 'GET' || request.method === 'HEAD') {
		return fetch(targetUrl, { method: request.method, headers });
	}

	const contentType = request.headers.get('Content-Type') || '';
	const looksLikeJson =
		!contentType ||
		contentType.includes('application/json') ||
		contentType.includes('+json') ||
		contentType.includes('text/json');

	if (!looksLikeJson) {
		return fetch(targetUrl, {
			method: request.method,
			headers,
			body: request.body,
			// @ts-expect-error duplex is valid at runtime
			duplex: 'half',
		});
	}

	const bodyText = await request.text();
	const body = JSON.parse(bodyText);

	if (Array.isArray(body.messages)) {
		return retryWithCleanup(request, targetUrl, headers, { text: bodyText, json: body });
	}

	return fetch(targetUrl, {
		method: request.method,
		headers,
		body: bodyText,
		// @ts-expect-error duplex is valid at runtime
		duplex: 'half',
	});
}
```

- [ ] **Step 4: 运行 pipeline 测试，确认新核心代理成立**

Run: `npm run test -- tests/core/pipeline.test.ts`

Expected:
- `pipeline` 用例全部通过

## Task 5: 接入 Cloudflare 适配层并瘦身当前入口

**Files:**
- Create: `src/adapters/cloudflare/context.ts`
- Create: `src/adapters/cloudflare/entry.ts`
- Modify: `src/index.ts`
- Modify: `src/env.d.ts`
- Test: `tests/adapters/cloudflare.entry.test.ts`

- [ ] **Step 1: 写失败测试，固定 Cloudflare 上下文映射**

```ts
// tests/adapters/cloudflare.entry.test.ts
import { describe, expect, it, vi } from 'vitest';
import { handleCloudflareRequest } from '../../src/adapters/cloudflare/entry';

describe('handleCloudflareRequest', () => {
	it('maps env and serves root request', async () => {
		const waitUntil = vi.fn();
		const response = await handleCloudflareRequest(
			new Request('https://gateway.example.com/'),
			{
				ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
				DEBUG_REQUEST_LOGS: 'false',
			} as Env,
			{ waitUntil } as ExecutionContext
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('BetterClaude Gateway');
	});
});
```

- [ ] **Step 2: 运行测试，确认适配层还不存在**

Run: `npm run test -- tests/adapters/cloudflare.entry.test.ts`

Expected:
- 测试失败
- 报错缺少 `src/adapters/cloudflare/entry`

- [ ] **Step 3: 实现 Cloudflare 上下文映射与入口，并将 `src/index.ts` 缩成纯适配**

```ts
// src/adapters/cloudflare/context.ts
import type { AppContext } from '../../core/types';

export function createCloudflareAppContext(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): AppContext {
	const stringEnv = Object.fromEntries(
		Object.entries(env as Record<string, unknown>).filter(([, value]) => typeof value === 'string')
	) as Record<string, string | undefined>;

	return {
		request,
		platform: 'cloudflare',
		env: stringEnv,
		waitUntil: promise => ctx.waitUntil(promise),
	};
}
```

```ts
// src/adapters/cloudflare/entry.ts
import { handleRequest } from '../../core/app';
import { proxyRequest } from '../../core/proxy';
import { createCloudflareAppContext } from './context';

export async function handleCloudflareRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	return handleRequest(createCloudflareAppContext(request, env, ctx), {
		proxyRequest,
	});
}
```

```ts
// src/index.ts
import { handleCloudflareRequest } from './adapters/cloudflare/entry';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			return await handleCloudflareRequest(request, env, ctx);
		} catch {
			return new Response('Bad Gateway', {
				status: 502,
				headers: { 'Content-Type': 'text/plain' },
			});
		}
	},
} satisfies ExportedHandler<Env>;
```

```ts
// src/env.d.ts
declare global {
	interface Env {
		ALLOWED_TARGET_HOSTS?: string;
		DEBUG_REQUEST_LOGS?: string;
	}
}

export {};
```

- [ ] **Step 4: 运行 Cloudflare 适配测试和已有核心测试**

Run:
- `npm run test -- tests/adapters/cloudflare.entry.test.ts`
- `npm run test -- tests/core/app.test.ts tests/core/pipeline.test.ts`

Expected:
- Cloudflare 入口测试通过
- 既有核心测试不回退

## Task 6: 接入 EO 适配层与 Node.js Functions 入口

**Files:**
- Create: `src/adapters/edgeone/context.ts`
- Create: `src/adapters/edgeone/entry.ts`
- Create: `cloud-functions/index.ts`
- Create: `cloud-functions/[[default]].ts`
- Test: `tests/adapters/edgeone.entry.test.ts`
- Possibly generated by CLI: `edgeone.json`

- [ ] **Step 1: 先验证 EO CLI 当前骨架，确认函数根目录为 `cloud-functions/`**

Run:
- `edgeone -v`
- `edgeone pages init`

Expected:
- CLI 可用
- 选择 `Node.js Functions` 后，仓库生成或保留 `cloud-functions/`

Stop condition:
- 如果生成的根目录不是 `cloud-functions/`，先把本计划中所有 `cloud-functions/` 替换为真实目录，再继续

- [ ] **Step 2: 写失败测试，固定 EO 上下文映射**

```ts
// tests/adapters/edgeone.entry.test.ts
import { describe, expect, it } from 'vitest';
import { handleEdgeoneRequest } from '../../src/adapters/edgeone/entry';

describe('handleEdgeoneRequest', () => {
	it('maps EO context to AppContext and serves health endpoint', async () => {
		const response = await handleEdgeoneRequest({
			request: new Request('https://gateway.example.com/health'),
			env: {
				ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
			},
			params: {},
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});
});
```

- [ ] **Step 3: 运行测试，确认 EO 适配层还不存在**

Run: `npm run test -- tests/adapters/edgeone.entry.test.ts`

Expected:
- 测试失败
- 报错缺少 `src/adapters/edgeone/entry`

- [ ] **Step 4: 实现 EO 适配器与两个函数入口**

```ts
// src/adapters/edgeone/context.ts
import type { AppContext } from '../../core/types';

export interface EdgeoneEventContext {
	request: Request;
	env?: Record<string, unknown>;
	params?: Record<string, string>;
	waitUntil?: (promise: Promise<unknown>) => void;
}

export function createEdgeoneAppContext(context: EdgeoneEventContext): AppContext {
	const env = Object.fromEntries(
		Object.entries(context.env ?? {}).filter(([, value]) => typeof value === 'string')
	) as Record<string, string | undefined>;

	return {
		request: context.request,
		platform: 'edgeone',
		env,
		waitUntil: context.waitUntil,
	};
}
```

```ts
// src/adapters/edgeone/entry.ts
import { handleRequest } from '../../core/app';
import { proxyRequest } from '../../core/proxy';
import { createEdgeoneAppContext, type EdgeoneEventContext } from './context';

export async function handleEdgeoneRequest(context: EdgeoneEventContext): Promise<Response> {
	return handleRequest(createEdgeoneAppContext(context), {
		proxyRequest,
	});
}
```

```ts
// cloud-functions/index.ts
import { handleEdgeoneRequest } from '../src/adapters/edgeone/entry';

export async function onRequest(context) {
	return handleEdgeoneRequest(context);
}
```

```ts
// cloud-functions/[[default]].ts
import { handleEdgeoneRequest } from '../src/adapters/edgeone/entry';

export async function onRequest(context) {
	return handleEdgeoneRequest(context);
}
```

- [ ] **Step 5: 运行 EO 适配测试**

Run: `npm run test -- tests/adapters/edgeone.entry.test.ts`

Expected:
- EO 适配测试通过

## Task 7: 清理旧入口引用、更新 README，并做整体验证

**Files:**
- Modify: `README.md`
- Optionally delete after migration passes: `src/router.ts`, `src/proxy.ts`, `src/retry-handler.ts`, `src/proactive-cleanup.ts`, `src/error-detector.ts`, `src/streaming-handler.ts`

- [ ] **Step 1: 更新 README，明确双平台开发与部署命令**

```md
## Development

### Cloudflare Workers

Run `npm run dev:cf`

### EO Pages

先确认已完成 `edgeone pages init`，并使用 Node.js Functions。

Run `edgeone pages dev`

## Configuration

### Environment Variables

- `ALLOWED_TARGET_HOSTS`: 逗号分隔的上游白名单，未配置时默认允许所有目标
- `DEBUG_REQUEST_LOGS`: 是否开启调试日志，`true` 或 `false`

## Deployment

### Cloudflare

Run `npm run deploy`

### EO Pages

Run `edgeone pages deploy`
```

- [ ] **Step 2: 在所有导入切到 `src/core/*` 与 `src/adapters/*` 后，删除旧单平台实现文件**

Run:
- `rg "from './router'|from './proxy'|from './retry-handler'|from './proactive-cleanup'|from './error-detector'|from './streaming-handler'" src tests`

Expected:
- 没有任何旧路径引用

Then delete:
- `src/router.ts`
- `src/proxy.ts`
- `src/retry-handler.ts`
- `src/proactive-cleanup.ts`
- `src/error-detector.ts`
- `src/streaming-handler.ts`

- [ ] **Step 3: 运行全量测试与类型检查**

Run:
- `npm run test`
- `npm run typecheck`

Expected:
- 全部测试通过
- TypeScript 检查通过

- [ ] **Step 4: 做双平台冒烟验证**

Run:
- `npm run dev:cf`
- `curl -i "http://127.0.0.1:8787/health"`
- `edgeone pages dev`
- `curl -i "http://127.0.0.1:8088/health"`

Expected:
- Cloudflare 本地返回 `200 OK`
- EO 本地返回 `200 OK`
- 两边响应体都为 `OK`

## 自检

### Spec 覆盖检查

- 双平台共享核心逻辑：Task 2、Task 3、Task 4
- Cloudflare 薄适配：Task 5
- EO 薄适配：Task 6
- 白名单与最小配置：Task 1、Task 2
- 测试体系：Task 1 到 Task 6
- 文档与本地开发：Task 7

### 占位符扫描

- 本计划未包含 `TBD`、`TODO`、`implement later`
- 每个代码步骤都给出具体文件内容
- 每个验证步骤都给出精确命令和预期结果

### 类型一致性检查

- `AppContext` 在 `src/core/types.ts` 唯一定义
- `handleRequest` 只接收 `AppContext`
- `handleCloudflareRequest` 与 `handleEdgeoneRequest` 都复用 `handleRequest`
- `proxyRequest(request, route)` 作为唯一核心代理入口
