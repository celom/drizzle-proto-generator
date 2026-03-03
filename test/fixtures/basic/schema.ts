import { pgSchema, varchar, integer, boolean, timestamp, uuid, text, bigint, real, doublePrecision, json, jsonb } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const users = appSchema.table('users', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  age: integer('age'),
  bio: text('bio'),
  isActive: boolean('is_active').notNull(),
  score: real('score'),
  balance: doublePrecision('balance'),
  loginCount: bigint('login_count', { mode: 'number' }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at'),
});

export const posts = appSchema.table('posts', {
  id: uuid('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').notNull(),
  views: integer('views').notNull(),
  published: boolean('published').notNull(),
  createdAt: timestamp('created_at').notNull(),
});
