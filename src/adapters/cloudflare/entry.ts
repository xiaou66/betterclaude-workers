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
