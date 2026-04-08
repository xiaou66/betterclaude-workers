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
