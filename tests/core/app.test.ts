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

	it('forwards request when whitelist is empty', async () => {
		const proxyRequest = vi.fn().mockResolvedValue(
			new Response('proxied', {
				status: 200,
				headers: { 'Content-Type': 'text/plain' },
			})
		);

		const response = await handleRequest(
			makeContext('https://gateway.example.com/claude/api.openai.com/v1/messages'),
			{ proxyRequest }
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('proxied');
		expect(proxyRequest).toHaveBeenCalledOnce();
	});
});
