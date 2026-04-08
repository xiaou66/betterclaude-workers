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
