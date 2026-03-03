import { test, expect, describe } from 'bun:test';
import { ProtoGenerator } from '../src/generator/proto-generator';
import type { DrizzleTable, DrizzleEnum, GeneratorConfig } from '../src/types';

function makeConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    inputPath: './src/schema',
    outputPath: './proto',
    protoPackageName: 'myapp',
    ...overrides,
  };
}

function makeTable(overrides: Partial<DrizzleTable> = {}): DrizzleTable {
  return {
    name: 'users',
    columns: [
      { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      { name: 'name', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      { name: 'email', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: true, isArray: false },
    ],
    ...overrides,
  };
}

describe('ProtoGenerator', () => {
  test('generates messages from tables', () => {
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([makeTable()], []);

    expect(result.size).toBe(1);

    const defaultFile = result.get('default');
    expect(defaultFile).toBeDefined();
    expect(defaultFile!.messages.length).toBe(1);
    expect(defaultFile!.messages[0]!.name).toBe('User');
  });

  test('generates correct field numbering starting at 1', () => {
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([makeTable()], []);

    const message = result.get('default')!.messages[0]!;
    expect(message.fields[0]!.number).toBe(1);
    expect(message.fields[1]!.number).toBe(2);
    expect(message.fields[2]!.number).toBe(3);
  });

  test('converts field names to camelCase by default', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.name).toBe('createdAt');
  });

  test('preserves snake_case when configured', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig({ options: { preserveSnakeCase: true } }));
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.name).toBe('created_at');
  });

  test('marks nullable non-PK fields as optional', () => {
    const table = makeTable({
      columns: [
        { name: 'bio', type: 'text', isNullable: true, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    expect(result.get('default')!.messages[0]!.fields[0]!.optional).toBe(true);
  });

  test('marks array columns as repeated', () => {
    const table = makeTable({
      columns: [
        { name: 'tags', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: true },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    expect(result.get('default')!.messages[0]!.fields[0]!.repeated).toBe(true);
  });

  test('groups tables by schema', () => {
    const tables = [
      makeTable({ name: 'accounts', schema: 'auth' }),
      makeTable({ name: 'sessions', schema: 'auth' }),
      makeTable({ name: 'invoices', schema: 'billing' }),
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles(tables, []);

    expect(result.has('auth')).toBe(true);
    expect(result.has('billing')).toBe(true);
    expect(result.get('auth')!.messages.length).toBe(2);
    expect(result.get('billing')!.messages.length).toBe(1);
  });

  test('generates correct package names', () => {
    const tables = [
      makeTable({ schema: 'auth' }),
      makeTable({ name: 'posts' }),
    ];
    const generator = new ProtoGenerator(makeConfig({ protoPackageName: 'myapp' }));
    const result = generator.generateProtoFiles(tables, []);

    expect(result.get('auth')!.package).toBe('myapp.auth.v1');
    expect(result.get('default')!.package).toBe('myapp.v1');
  });

  test('generates proto enums from drizzle enums', () => {
    const table = makeTable({
      columns: [
        { name: 'role', type: 'userRoleEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: DrizzleEnum[] = [
      { name: 'userRoleEnum', values: ['admin', 'editor', 'viewer'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums);

    const file = result.get('default')!;
    expect(file.enums.length).toBe(1);
    expect(file.enums[0]!.name).toBe('UserRole');
  });

  test('adds UNSPECIFIED enum value by default', () => {
    const table = makeTable({
      columns: [
        { name: 'role', type: 'userRoleEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: DrizzleEnum[] = [
      { name: 'userRoleEnum', values: ['admin', 'viewer'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums);

    const protoEnum = result.get('default')!.enums[0]!;
    expect(protoEnum.values[0]!.name).toContain('UNSPECIFIED');
    expect(protoEnum.values[0]!.number).toBe(0);
    expect(protoEnum.values[1]!.number).toBe(1);
  });

  test('skips UNSPECIFIED when configured', () => {
    const table = makeTable({
      columns: [
        { name: 'role', type: 'userRoleEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: DrizzleEnum[] = [
      { name: 'userRoleEnum', values: ['admin', 'viewer'] },
    ];
    const generator = new ProtoGenerator(makeConfig({ options: { addUnspecified: false } }));
    const result = generator.generateProtoFiles([table], enums);

    const protoEnum = result.get('default')!.enums[0]!;
    expect(protoEnum.values[0]!.name).not.toContain('UNSPECIFIED');
    expect(protoEnum.values[0]!.number).toBe(0);
  });

  test('adds google/protobuf/timestamp.proto import for timestamp fields', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    expect(result.get('default')!.imports).toContain('google/protobuf/timestamp.proto');
  });

  test('generates common proto file for shared enums', () => {
    const tables = [
      makeTable({
        name: 'members',
        schema: 'auth',
        columns: [
          { name: 'status', type: 'statusEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
        ],
      }),
      makeTable({
        name: 'orders',
        schema: 'billing',
        columns: [
          { name: 'status', type: 'statusEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
        ],
      }),
    ];
    const enums: DrizzleEnum[] = [
      { name: 'statusEnum', values: ['active', 'inactive'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles(tables, enums);

    expect(result.has('common')).toBe(true);
    const commonFile = result.get('common')!;
    expect(commonFile.enums.length).toBe(1);
    expect(commonFile.package).toBe('myapp.common.v1');
  });

  test('uses proto3 syntax', () => {
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([makeTable()], []);

    expect(result.get('default')!.syntax).toBe('proto3');
  });

  test('does not singularize table names ending in ss/us/is', () => {
    const tables = [
      makeTable({ name: 'status', columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      ]}),
      makeTable({ name: 'access', columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      ]}),
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles(tables, []);

    const messages = result.get('default')!.messages;
    expect(messages.find(m => m.name === 'Status')).toBeDefined();
    expect(messages.find(m => m.name === 'Access')).toBeDefined();
  });

  test('correctly singularizes common table names', () => {
    const tables = [
      makeTable({ name: 'categories', columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      ]}),
      makeTable({ name: 'addresses', columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      ]}),
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles(tables, []);

    const messages = result.get('default')!.messages;
    expect(messages.find(m => m.name === 'Category')).toBeDefined();
    expect(messages.find(m => m.name === 'Address')).toBeDefined();
  });

  test('maps timestamp fields to string when useGoogleTimestamp is false', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig({ options: { useGoogleTimestamp: false } }));
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('string');
    expect(result.get('default')!.imports).not.toContain('google/protobuf/timestamp.proto');
  });

  test('resolves enums by direct enumMap match regardless of naming convention', () => {
    const table = makeTable({
      columns: [
        { name: 'role', type: 'role', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: DrizzleEnum[] = [
      { name: 'role', values: ['admin', 'viewer'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums);

    const file = result.get('default')!;
    expect(file.enums.length).toBe(1);
    expect(file.enums[0]!.name).toBe('Role');
    expect(file.messages[0]!.fields[0]!.type).toBe('Role');
  });
});

describe('ProtoGenerator - edge cases', () => {
  test('produces no output for empty tables and enums', () => {
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([], []);

    expect(result.size).toBe(0);
  });

  test('handles table with no columns gracefully', () => {
    const table = makeTable({ columns: [] });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const file = result.get('default')!;
    expect(file.messages.length).toBe(1);
    expect(file.messages[0]!.fields).toEqual([]);
  });

  test('falls back to string for unresolved enum column type', () => {
    const table = makeTable({
      columns: [
        { name: 'status', type: 'enum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    // No enums provided — the 'enum' type cannot be resolved
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('string');
  });

  test('handles enums with no table references (unused enums are not included)', () => {
    const table = makeTable({
      columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
      ],
    });
    const enums: DrizzleEnum[] = [
      { name: 'unusedEnum', values: ['a', 'b'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums);

    const file = result.get('default')!;
    expect(file.enums).toEqual([]);
  });
});
