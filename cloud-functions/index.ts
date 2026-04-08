import { handleEdgeoneRequest } from '../src/adapters/edgeone/entry';
import type { EdgeoneEventContext } from '../src/adapters/edgeone/context';

export async function onRequest(context: EdgeoneEventContext) {
	return handleEdgeoneRequest(context);
}
