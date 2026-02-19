# macmac

A game that builds intuition for [Markov Chain Monte Carlo](https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo) — one of the most important ideas in computational statistics and machine learning.

![macmac](static/og-image.png)

## How it works

See a target probability density. Click to place samples. A kernel density estimate builds in real time to show how well your samples match the target shape.

Your score balances two objectives:

- **Accuracy** — measured by [KL divergence](https://en.wikipedia.org/wiki/Kullback%E2%80%93Leibler_divergence) between the true distribution and your empirical one
- **Efficiency** — fewer clicks means a higher score

The best players find the sweet spot: enough samples to capture the distribution's shape, placed strategically where the density matters most — without wasting clicks.

## Levels

8 levels from easy to expert:

| # | Name | Difficulty | Description |
|---|------|-----------|-------------|
| 1 | The Bell Curve | Easy | Standard normal — a gentle start |
| 2 | Flat Land | Easy | Uniform distribution |
| 3 | The Slide | Easy | Exponential decay |
| 4 | Lean Right | Medium | Skewed (chi-squared) |
| 5 | Twin Peaks | Medium | Bimodal mixture |
| 6 | The Comb | Hard | Trimodal mixture |
| 7 | The Skyscraper | Hard | Needle spike + broad background |
| 8 | The Gauntlet | Expert | Spikes + uniform plateau + broad modes |

## Tech stack

- [SvelteKit 5](https://svelte.dev/) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Drizzle ORM](https://orm.drizzle.team/) + [Turso](https://turso.tech/) (libSQL)
- [KaTeX](https://katex.org/) for math rendering
- Canvas API for game visualization
- Deployed on [Vercel](https://vercel.com/)

## Local development

```bash
git clone https://github.com/NeoVand/MacMac.git
cd MacMac
npm install
```

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

For local development with a file-based SQLite database, set:

```
DATABASE_URL=file:local.db
```

Push the database schema and start the dev server:

```bash
npx drizzle-kit push
npm run dev
```

## Deployment

The app is configured for Vercel with a Turso database:

1. Create a free [Turso](https://turso.tech/) database
2. Push to GitHub
3. Import the repo in [Vercel](https://vercel.com/)
4. Set environment variables: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ORIGIN`, `BETTER_AUTH_SECRET`
5. Deploy

## Created by

[Neo Mohsenvand](https://github.com/NeoVand)
