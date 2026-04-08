import { handleRequest } from '../../core/app';
import { proxyRequest } from '../../core/proxy';
import { createEdgeoneAppContext, type EdgeoneEventContext } from './context';

export async function handleEdgeoneRequest(context: EdgeoneEventContext): Promise<Response> {
	return handleRequest(createEdgeoneAppContext(context), {
		proxyRequest,
	});
}
