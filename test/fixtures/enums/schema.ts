import { pgSchema, pgEnum, varchar, uuid, timestamp } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['admin', 'editor', 'viewer']);
export const statusEnum = pgEnum('status', ['active', 'inactive', 'pending']);

export const appSchema = pgSchema('app');

export const members = appSchema.table('members', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull(),
  status: statusEnum('status').notNull(),
  createdAt: timestamp('created_at').notNull(),
});
