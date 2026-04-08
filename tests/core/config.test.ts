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
		expect(isTargetHostAllowed('api.openai.com', config)).toBe(true);
	});

	it('matches hosts case-insensitively', () => {
		const config = loadRuntimeConfig({
			ALLOWED_TARGET_HOSTS: 'api.anthropic.com',
		});

		expect(isTargetHostAllowed('API.Anthropic.Com', config)).toBe(true);
		expect(isTargetHostAllowed('api.openai.com', config)).toBe(false);
	});
});
