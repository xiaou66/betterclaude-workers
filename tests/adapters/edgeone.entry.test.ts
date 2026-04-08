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
