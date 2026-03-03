import { pgSchema, varchar, uuid, timestamp, integer } from 'drizzle-orm/pg-core';

export const authSchema = pgSchema('auth');
export const billingSchema = pgSchema('billing');

export const accounts = authSchema.table('accounts', {
  id: uuid('id').primaryKey(),
  username: varchar('username', { length: 100 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull(),
});

export const sessions = authSchema.table('sessions', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  token: varchar('token', { length: 500 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const invoices = billingSchema.table('invoices', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at').notNull(),
});
