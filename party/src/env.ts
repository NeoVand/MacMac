import type { BattleServer } from './battle';
import type { Matchmaker } from './matchmaker';

export interface Env {
	Main: DurableObjectNamespace<BattleServer>;
	Matchmaker: DurableObjectNamespace<Matchmaker>;
	// Keep the existing name so SvelteKit can verify signed battle results.
	PARTYKIT_SECRET?: string;
}
