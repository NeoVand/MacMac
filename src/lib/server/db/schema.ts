import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Player profile — one row per player, holds all stats and ratings. */
export const players = sqliteTable('players', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id').notNull().unique(),
	playerName: text('player_name').notNull(),
	country: text('country'),
	// Casual stats
	rating: real('rating').notNull().default(0),
	gamesPlayed: integer('games_played').notNull().default(0),
	bestWeightedScore: integer('best_weighted_score').notNull().default(0),
	bestScoreDifficulty: real('best_score_difficulty').notNull().default(0),
	// Battle stats (Phase 2)
	battleElo: integer('battle_elo').notNull().default(1200),
	battlesPlayed: integer('battles_played').notNull().default(0),
	battleWins: integer('battle_wins').notNull().default(0),
	// Timestamps
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** Legacy scores table — kept for historical data, no longer written to. */
export const scores = sqliteTable('scores', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	playerName: text('player_name').notNull(),
	playerId: text('player_id').notNull(),
	levelId: integer('level_id').notNull(),
	score: integer('score').notNull(),
	klDivergence: real('kl_divergence').notNull(),
	clicks: integer('clicks').notNull(),
	duration: integer('duration'),
	country: text('country'),
	samples: text('samples').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export * from './auth.schema';
