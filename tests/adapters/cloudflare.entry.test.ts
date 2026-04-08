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
			{ waitUntil } as unknown as ExecutionContext
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('BetterClaude Gateway');
	});
});
