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
