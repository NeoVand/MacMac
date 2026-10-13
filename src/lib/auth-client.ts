import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const BEFORE_SIGN_IN_EVENT = 'macmacbeforesignin';
export const SIGN_IN_FAILED_EVENT = 'macmacsigninfailed';

declare module 'svelte/elements' {
	interface SvelteWindowAttributes {
		onmacmacbeforesignin?: (event: Event) => void;
		onmacmacsigninfailed?: (event: Event) => void;
	}
}

let signingIn = false;

export function preventSignIn(event: Event, error: string): void {
	event.preventDefault();
	if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
		(event.detail as { error: string }).error = error;
	}
}

/** Every OAuth entry point gives the active game a synchronous chance to persist. */
export async function signInWithProvider(provider: 'github' | 'google'): Promise<void> {
	if (signingIn) return;
	const request = new CustomEvent(BEFORE_SIGN_IN_EVENT, {
		cancelable: true,
		detail: { error: '' }
	});
	if (!window.dispatchEvent(request)) {
		throw new Error(
			request.detail.error ||
				'Your browser could not preserve this game. Enable browser storage and try again.'
		);
	}
	signingIn = true;
	try {
		const callback = new URL(window.location.href);
		callback.searchParams.delete('error');
		callback.searchParams.delete('error_description');
		const callbackURL = callback.href;
		const result = await authClient.signIn.social({
			provider,
			callbackURL,
			errorCallbackURL: callbackURL
		});
		if (result.error)
			throw new Error(result.error.message || 'Sign-in could not start. Please try again.');
	} catch (error) {
		window.dispatchEvent(new Event(SIGN_IN_FAILED_EVENT));
		throw error;
	} finally {
		signingIn = false;
	}
}
