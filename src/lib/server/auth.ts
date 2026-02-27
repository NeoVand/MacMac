import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/**
 * Resolve the app's base URL for better-auth.
 * Priority: BETTER_AUTH_URL > ORIGIN > Vercel production URL > localhost fallback.
 * On Vercel, ORIGIN may not be set; VERCEL_PROJECT_PRODUCTION_URL provides the
 * custom domain (e.g. "macmac.lol") without the protocol prefix.
 */
function getBaseURL(): string {
	if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
	if (env.ORIGIN) return env.ORIGIN;
	if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
	if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
	return 'http://localhost:5173';
}

export const auth = betterAuth({
	baseURL: getBaseURL(),
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	socialProviders: {
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET
		},
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET
		}
	},
	plugins: [sveltekitCookies(getRequestEvent)] // make sure this is the last plugin in the array
});
