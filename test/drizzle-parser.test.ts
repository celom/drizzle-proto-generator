import { test, expect, describe } from 'bun:test';
import { DrizzleSchemaParser } from '../src/parser/drizzle-parser';
import * as path from 'path';

const FIXTURES_DIR = path.join(import.meta.dir, 'fixtures');

describe('DrizzleSchemaParser', () => {
  test('parses basic table with columns', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'basic'));

    expect(result.tables.length).toBeGreaterThanOrEqual(1);

    const usersTable = result.tables.find(t => t.name === 'users');
    expect(usersTable).toBeDefined();
    expect(usersTable!.columns.length).toBeGreaterThan(0);

    const idCol = usersTable!.columns.find(c => c.name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol!.isPrimaryKey).toBe(true);

    const nameCol = usersTable!.columns.find(c => c.name === 'name');
    expect(nameCol).toBeDefined();
    expect(nameCol!.isNullable).toBe(false);

    const emailCol = usersTable!.columns.find(c => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol!.isUnique).toBe(true);
  });

  test('parses multiple tables from one file', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'basic'));

    const tableNames = result.tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('posts');
  });

  test('parses enum definitions', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'enums'));

    expect(result.enums.length).toBeGreaterThanOrEqual(1);

    const roleEnum = result.enums.find(e => e.name === 'userRoleEnum');
    expect(roleEnum).toBeDefined();
    expect(roleEnum!.values).toEqual(['admin', 'editor', 'viewer']);
  });

  test('parses tables with enum columns', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'enums'));

    const membersTable = result.tables.find(t => t.name === 'members');
    expect(membersTable).toBeDefined();

    const roleCol = membersTable!.columns.find(c => c.name === 'role');
    expect(roleCol).toBeDefined();
  });

  test('parses schema groupings', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'multi-schema'));

    expect(result.schemas.length).toBeGreaterThanOrEqual(2);
    expect(result.schemas).toContain('auth');
    expect(result.schemas).toContain('billing');

    const accountsTable = result.tables.find(t => t.name === 'accounts');
    expect(accountsTable).toBeDefined();
    expect(accountsTable!.schema).toBe('auth');

    const invoicesTable = result.tables.find(t => t.name === 'invoices');
    expect(invoicesTable).toBeDefined();
    expect(invoicesTable!.schema).toBe('billing');
  });

  test('detects nullable columns', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'basic'));

    const usersTable = result.tables.find(t => t.name === 'users')!;
    expect(usersTable).toBeDefined();

    // age has no .notNull(), should be nullable
    const ageCol = usersTable.columns.find(c => c.name === 'age');
    expect(ageCol).toBeDefined();
    expect(ageCol!.isNullable).toBe(true);

    // name has .notNull(), should not be nullable
    const nameCol = usersTable.columns.find(c => c.name === 'name');
    expect(nameCol!.isNullable).toBe(false);
  });
});
