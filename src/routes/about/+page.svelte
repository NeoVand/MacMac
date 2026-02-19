<svelte:head>
	<title>About — MacMac</title>
</svelte:head>

<div class="mx-auto min-h-dvh max-w-xl px-6 py-10 sm:px-10 sm:py-16">
	<a href="/" class="text-xs text-white/25 transition hover:text-white/50">← Back to MacMac</a>

	<h1 class="mt-6 mb-6 text-2xl font-bold text-white" style="font-family: 'Space Grotesk', sans-serif;">
		About <span class="text-game-cyan">macmac</span>
	</h1>

	<div class="space-y-5 text-sm leading-relaxed text-white/45">
		<p>
			<strong class="text-white/70">MacMac</strong> is a game that builds intuition for
			<strong class="text-white/70">Markov Chain Monte Carlo (MCMC)</strong> — one of the most important
			ideas in computational statistics and machine learning.
		</p>

		<p>
			In MCMC, the goal is to draw samples from a probability distribution. The challenge is doing it
			<em>efficiently</em> — capturing the shape of a distribution with as few samples as possible.
			That's exactly what you're doing in this game.
		</p>

		<h2 class="pt-2 text-base font-semibold text-white/60">How it works</h2>

		<p>
			Each level shows you a target probability density function. You click on the axis to place
			samples. As you add points, a kernel density estimate (KDE) builds up to show what your
			samples imply about the underlying distribution.
		</p>

		<p>
			Your score is based on two factors:
		</p>

		<ul class="list-inside list-disc space-y-1 pl-1 text-white/40">
			<li>
				<strong class="text-white/55">Accuracy</strong> — measured by
				<a href="https://en.wikipedia.org/wiki/Kullback%E2%80%93Leibler_divergence" target="_blank" rel="noopener" class="text-game-cyan/60 underline decoration-game-cyan/20 transition hover:text-game-cyan/80">KL divergence</a>
				between the true distribution and your empirical one
			</li>
			<li>
				<strong class="text-white/55">Efficiency</strong> — fewer clicks means a higher score
			</li>
		</ul>

		<p>
			The best players find the sweet spot: enough samples to capture the distribution's shape, placed
			strategically where the density matters most — without wasting clicks.
		</p>

		<h2 class="pt-2 text-base font-semibold text-white/60">Why it matters</h2>

		<p>
			MCMC methods are used everywhere — from Bayesian inference to protein folding to language models.
			The core question is always the same: how can we represent a complex distribution with a
			finite set of samples? This game lets you experience that question firsthand.
		</p>

		<div class="mt-8 flex flex-col gap-3 border-t border-white/5 pt-6">
			<div class="text-xs text-white/25">
				Created by <span class="text-white/50">Neo Mohsenvand</span>
			</div>
			<a
				href="https://github.com/NeoVand/MacMac"
				target="_blank"
				rel="noopener"
				class="flex w-fit items-center gap-2 text-xs text-white/30 transition hover:text-white/60"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
					<path fill-rule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0020 10.017C20 4.484 15.522 0 10 0z" clip-rule="evenodd" />
				</svg>
				View on GitHub
			</a>
		</div>
	</div>
</div>
