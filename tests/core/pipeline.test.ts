import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectOrphanedToolError } from '../../src/core/error-detector';
import { detectAndRemoveOrphanedToolResults } from '../../src/core/proactive-cleanup';
import { proxyRequest } from '../../src/core/proxy';
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
					message: 'unexpected `tool_use_id` found in `tool_result` blocks: toolu_deadbeef',
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
