<script lang="ts">
	import { authClient, signInWithProvider } from '$lib/auth-client';
	import { User, LogOut, Github } from 'lucide-svelte';

	interface Props {
		size?: 'sm' | 'md';
	}

	let { size = 'md' }: Props = $props();

	const session = authClient.useSession();

	let showMenu = $state(false);
	let showSignIn = $state(false);
	let isSigningIn = $state(false);
	let signInError = $state('');

	const iconSize = $derived(size === 'sm' ? 16 : 17);

	function handleAvatarClick() {
		if ($session.data) showMenu = !showMenu;
		else showSignIn = true;
	}

	async function signInWith(provider: 'github' | 'google') {
		if (isSigningIn) return;
		isSigningIn = true;
		signInError = '';
		try {
			await signInWithProvider(provider);
		} catch (error) {
			signInError = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
		} finally {
			isSigningIn = false;
		}
	}

	async function signOut() {
		await authClient.signOut();
		showMenu = false;
		window.location.reload();
	}
</script>

<div class="relative">
	<button
		onclick={handleAvatarClick}
		class="account-trigger"
		aria-label={$session.data ? 'Account menu' : 'Sign in'}
	>
		{#if $session.data?.user?.image}
			<img src={$session.data.user.image} alt="" class="h-full w-full object-cover" />
		{:else if $session.data?.user}
			<span class="text-xs font-medium"
				>{($session.data.user.name || '?').charAt(0).toUpperCase()}</span
			>
		{:else}
			<User size={iconSize} />
		{/if}
	</button>

	{#if showMenu && $session.data}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-40" onclick={() => (showMenu = false)} onkeydown={() => {}}></div>
		<div
			class="absolute top-full right-0 z-50 mt-1 w-48 rounded-lg p-2 shadow-xl"
			style="background: var(--surface); "
		>
			<div class="mb-2 px-2 pt-1">
				<div class="text-xs font-medium" style="color: var(--text-primary);">
					{$session.data.user.name}
				</div>
				<div class="text-[10px]" style="color: var(--text-secondary);">
					{$session.data.user.email}
				</div>
			</div>
			<button
				onclick={signOut}
				class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:opacity-70"
				style="color: var(--text-secondary);"
			>
				<LogOut size={12} />
				Sign out
			</button>
		</div>
	{/if}

	{#if showSignIn && !$session.data}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
			style="background: var(--overlay);"
			onclick={(e) => {
				if (e.target === e.currentTarget) showSignIn = false;
			}}
			onkeydown={(e) => e.key === 'Escape' && (showSignIn = false)}
		>
			<div
				class="mx-4 w-full max-w-xs rounded-2xl p-6 shadow-2xl"
				style="background: var(--surface); "
			>
				<h3
					class="mb-1 text-base font-bold"
					style="font-family: var(--font-display); color: var(--text-primary);"
				>
					Sign in
				</h3>
				<p class="mb-5 text-xs" style="color: var(--text-secondary);">
					Sign in to submit scores to the leaderboard.
				</p>
				{#if signInError}
					<p role="alert" class="mb-3 text-xs" style="color: var(--accent-orange);">
						{signInError}
					</p>
				{/if}
				<div class="flex flex-col gap-2">
					<button
						onclick={() => signInWith('github')}
						disabled={isSigningIn || $session.isPending}
						class="flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition hover:opacity-80"
						style="background: var(--surface-raised); color: var(--text-secondary); "
					>
						<Github size={16} />
						Continue with GitHub
					</button>
					<button
						onclick={() => signInWith('google')}
						disabled={isSigningIn || $session.isPending}
						class="flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition hover:opacity-80"
						style="background: var(--surface-raised); color: var(--text-secondary); "
					>
						<svg viewBox="0 0 24 24" class="h-4 w-4"
							><path
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
								fill="#4285F4"
							/><path
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
								fill="#34A853"
							/><path
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
								fill="#FBBC05"
							/><path
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
								fill="#EA4335"
							/></svg
						>
						Continue with Google
					</button>
				</div>
				<button
					onclick={() => (showSignIn = false)}
					class="mt-3 min-h-11 w-full text-center text-xs transition hover:opacity-70"
					style="color: var(--text-secondary);">Cancel</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.account-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		overflow: hidden;

		border-radius: 11px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.account-trigger:hover {
		background: var(--surface);
		color: var(--text-primary);
	}
	.account-trigger:focus-visible {
		background: var(--accent-cyan);
		color: var(--on-accent);
		outline: none;
	}
</style>
