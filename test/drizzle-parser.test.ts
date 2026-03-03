import { test, expect, describe, beforeAll } from 'bun:test';
import { DrizzleSchemaParser } from '../src/parser/drizzle-parser';
import type { ParsedSchema } from '../src/types';
import * as path from 'path';

const FIXTURES_DIR = path.join(import.meta.dir, 'fixtures');

describe('DrizzleSchemaParser - edge cases', () => {
  test('returns empty results for directory with no .ts files', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'empty'));

    expect(result.tables).toEqual([]);
    expect(result.enums).toEqual([]);
    expect(result.schemas).toEqual([]);
  });

  test('returns empty tables when schema file has no table definitions', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'no-tables'));

    expect(result.tables).toEqual([]);
    expect(result.schemas).toContain('app');
  });

  test('returns empty results for nonexistent directory', async () => {
    const parser = new DrizzleSchemaParser();
    const result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'does-not-exist'));

    expect(result.tables).toEqual([]);
    expect(result.enums).toEqual([]);
    expect(result.schemas).toEqual([]);
  });
});

describe('DrizzleSchemaParser - basic fixture', () => {
  let result: ParsedSchema;

  beforeAll(async () => {
    const parser = new DrizzleSchemaParser();
    result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'basic'));
  });

  test('parses basic table with columns', () => {
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

  test('parses multiple tables from one file', () => {
    const tableNames = result.tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('posts');
  });

  test('detects nullable columns', () => {
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

describe('DrizzleSchemaParser - enums fixture', () => {
  let result: ParsedSchema;

  beforeAll(async () => {
    const parser = new DrizzleSchemaParser();
    result = await parser.parseSchemas(path.join(FIXTURES_DIR, 'enums'));
  });

  test('parses enum definitions', () => {
    expect(result.enums.length).toBeGreaterThanOrEqual(1);

    const roleEnum = result.enums.find(e => e.name === 'userRoleEnum');
    expect(roleEnum).toBeDefined();
    expect(roleEnum!.values).toEqual(['admin', 'editor', 'viewer']);
  });

  test('parses tables with enum columns', () => {
    const membersTable = result.tables.find(t => t.name === 'members');
    expect(membersTable).toBeDefined();

    const roleCol = membersTable!.columns.find(c => c.name === 'role');
    expect(roleCol).toBeDefined();
  });
});

describe('DrizzleSchemaParser - multi-schema fixture', () => {
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
});

describe('DrizzleSchemaParser - parser reuse', () => {
  test('does not leak knownEnumNames across parseSchemas calls', async () => {
    const parser = new DrizzleSchemaParser();

    // First call: parse enums fixture (has userRoleEnum, statusEnum)
    const enumResult = await parser.parseSchemas(path.join(FIXTURES_DIR, 'enums'));
    expect(enumResult.enums.length).toBeGreaterThanOrEqual(1);

    // Second call: parse basic fixture (has no enums)
    const basicResult = await parser.parseSchemas(path.join(FIXTURES_DIR, 'basic'));

    // Enum names from first call should not affect column type detection in second call
    const usersTable = basicResult.tables.find(t => t.name === 'users');
    expect(usersTable).toBeDefined();

    // All columns should have standard types, not be misidentified as enums
    for (const col of usersTable!.columns) {
      expect(col.type).not.toBe('userRoleEnum');
      expect(col.type).not.toBe('statusEnum');
    }
  });
});
