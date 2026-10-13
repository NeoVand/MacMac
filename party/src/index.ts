import { routePartykitRequest } from 'partyserver';
import type { Env } from './env';

export { BattleServer } from './battle';
export { Matchmaker } from './matchmaker';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (new URL(request.url).pathname === '/health') {
			return Response.json({ ok: true, service: 'macmac-battle' });
		}
		return (await routePartykitRequest(request, env)) ?? new Response('Not Found', { status: 404 });
	}
} satisfies ExportedHandler<Env>;
