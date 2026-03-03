import { pgSchema } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

// No tables defined, just a schema
const someHelper = (x: number) => x * 2;
