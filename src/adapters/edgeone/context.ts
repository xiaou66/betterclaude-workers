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
