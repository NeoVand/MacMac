import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
	samples: text('samples').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export * from './auth.schema';
