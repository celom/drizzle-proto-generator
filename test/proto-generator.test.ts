import { test, expect, describe } from 'bun:test';
import { ProtoGenerator } from '../src/generator/proto-generator';
import type { SchemaTable, SchemaEnum, GeneratorConfig, ExistingFieldMap, FieldNumberRegistry } from '../src/types';

function makeConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    inputPath: './src/schema',
    outputPath: './proto',
    protoPackageName: 'myapp',
    ...overrides,
  };
}

function makeTable(overrides: Partial<SchemaTable> = {}): SchemaTable {
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

  test('uses snake_case field names by default', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.name).toBe('created_at');
  });

  test('converts to camelCase when configured', () => {
    const table = makeTable({
      columns: [
        { name: 'created_at', type: 'timestamp', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig({ options: { useCamelCase: true } }));
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.name).toBe('createdAt');
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
    const enums: SchemaEnum[] = [
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
    const enums: SchemaEnum[] = [
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
    const enums: SchemaEnum[] = [
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
    const enums: SchemaEnum[] = [
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

  test('maps date fields to google.type.Date when useGoogleDate is true', () => {
    const table = makeTable({
      columns: [
        { name: 'birth_date', type: 'date', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig({ options: { useGoogleDate: true } }));
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('google.type.Date');
    expect(result.get('default')!.imports).toContain('google/type/date.proto');
  });

  test('maps date fields to Timestamp by default (useGoogleDate false)', () => {
    const table = makeTable({
      columns: [
        { name: 'birth_date', type: 'date', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('google.protobuf.Timestamp');
    expect(result.get('default')!.imports).not.toContain('google/type/date.proto');
  });

  test('maps json/jsonb fields to google.protobuf.Struct when useGoogleStruct is true', () => {
    const table = makeTable({
      columns: [
        { name: 'metadata', type: 'jsonb', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig({ options: { useGoogleStruct: true } }));
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('google.protobuf.Struct');
    expect(result.get('default')!.imports).toContain('google/protobuf/struct.proto');
  });

  test('maps json/jsonb fields to string by default (useGoogleStruct false)', () => {
    const table = makeTable({
      columns: [
        { name: 'metadata', type: 'jsonb', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], []);

    const field = result.get('default')!.messages[0]!.fields[0]!;
    expect(field.type).toBe('string');
    expect(result.get('default')!.imports).not.toContain('google/protobuf/struct.proto');
  });

  test('resolves enums by direct enumMap match regardless of naming convention', () => {
    const table = makeTable({
      columns: [
        { name: 'role', type: 'role', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: SchemaEnum[] = [
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
    const enums: SchemaEnum[] = [
      { name: 'unusedEnum', values: ['a', 'b'] },
    ];
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums);

    const file = result.get('default')!;
    expect(file.enums).toEqual([]);
  });
});

function makeExistingFieldMap(overrides: Partial<ExistingFieldMap> = {}): ExistingFieldMap {
  return {
    messages: new Map(),
    enums: new Map(),
    messageReservedNumbers: new Map(),
    messageReservedNames: new Map(),
    enumReservedNumbers: new Map(),
    enumReservedNames: new Map(),
    ...overrides,
  };
}

describe('ProtoGenerator - field number stability', () => {
  test('preserves field numbers from registry', () => {
    const existingFieldMap = makeExistingFieldMap({
      messages: new Map([
        ['User', new Map([['id', 1], ['name', 3], ['email', 5]])],
      ]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([makeTable()], [], registry);

    const message = result.get('default')!.messages[0]!;
    expect(message.fields.find(f => f.name === 'id')!.number).toBe(1);
    expect(message.fields.find(f => f.name === 'name')!.number).toBe(3);
    expect(message.fields.find(f => f.name === 'email')!.number).toBe(5);
  });

  test('assigns next available numbers to new fields', () => {
    const existingFieldMap = makeExistingFieldMap({
      messages: new Map([
        ['User', new Map([['id', 1], ['name', 2]])],
      ]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    const table = makeTable({
      columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
        { name: 'name', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
        { name: 'age', type: 'integer', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], [], registry);

    const message = result.get('default')!.messages[0]!;
    expect(message.fields.find(f => f.name === 'id')!.number).toBe(1);
    expect(message.fields.find(f => f.name === 'name')!.number).toBe(2);
    expect(message.fields.find(f => f.name === 'age')!.number).toBe(3);
  });

  test('adds reserved entries for removed fields', () => {
    const existingFieldMap = makeExistingFieldMap({
      messages: new Map([
        ['User', new Map([['id', 1], ['name', 2], ['bio', 3]])],
      ]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    // Table now only has id and name (bio was removed)
    const table = makeTable({
      columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
        { name: 'name', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], [], registry);

    const message = result.get('default')!.messages[0]!;
    expect(message.reservedNumbers).toEqual([3]);
    expect(message.reservedNames).toEqual(['bio']);
  });

  test('carries forward existing reserved entries', () => {
    const existingFieldMap = makeExistingFieldMap({
      messages: new Map([
        ['User', new Map([['id', 1], ['name', 2], ['email', 4]])],
      ]),
      messageReservedNumbers: new Map([['User', [3]]]),
      messageReservedNames: new Map([['User', ['bio']]]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    // Now remove email too
    const table = makeTable({
      columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
        { name: 'name', type: 'varchar', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], [], registry);

    const message = result.get('default')!.messages[0]!;
    expect(message.reservedNumbers).toEqual([3, 4]);
    expect(message.reservedNames).toEqual(['bio', 'email']);
  });

  test('new field does not reuse reserved numbers', () => {
    const existingFieldMap = makeExistingFieldMap({
      messages: new Map([
        ['User', new Map([['id', 1]])],
      ]),
      messageReservedNumbers: new Map([['User', [2, 3]]]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    const table = makeTable({
      columns: [
        { name: 'id', type: 'uuid', isNullable: false, isPrimaryKey: true, isUnique: false, isArray: false },
        { name: 'age', type: 'integer', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], [], registry);

    const message = result.get('default')!.messages[0]!;
    // age should get 4 (1 is used, 2 and 3 are reserved)
    expect(message.fields.find(f => f.name === 'age')!.number).toBe(4);
  });

  test('falls back to sequential numbering without registry', () => {
    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([makeTable()], []);

    const message = result.get('default')!.messages[0]!;
    expect(message.fields[0]!.number).toBe(1);
    expect(message.fields[1]!.number).toBe(2);
    expect(message.fields[2]!.number).toBe(3);
    expect(message.reservedNumbers).toBeUndefined();
    expect(message.reservedNames).toBeUndefined();
  });

  test('preserves enum value numbers from registry', () => {
    const existingFieldMap = makeExistingFieldMap({
      enums: new Map([
        ['UserRole', new Map([
          ['USER_ROLE_UNSPECIFIED', 0],
          ['USER_ROLE_ADMIN', 1],
          ['USER_ROLE_VIEWER', 2],
        ])],
      ]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    const table = makeTable({
      columns: [
        { name: 'role', type: 'userRoleEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    const enums: SchemaEnum[] = [
      { name: 'userRoleEnum', values: ['admin', 'viewer'] },
    ];

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums, registry);

    const protoEnum = result.get('default')!.enums[0]!;
    expect(protoEnum.values.find(v => v.name === 'USER_ROLE_UNSPECIFIED')!.number).toBe(0);
    expect(protoEnum.values.find(v => v.name === 'USER_ROLE_ADMIN')!.number).toBe(1);
    expect(protoEnum.values.find(v => v.name === 'USER_ROLE_VIEWER')!.number).toBe(2);
  });

  test('adds reserved entries for removed enum values', () => {
    const existingFieldMap = makeExistingFieldMap({
      enums: new Map([
        ['UserRole', new Map([
          ['USER_ROLE_UNSPECIFIED', 0],
          ['USER_ROLE_ADMIN', 1],
          ['USER_ROLE_EDITOR', 2],
          ['USER_ROLE_VIEWER', 3],
        ])],
      ]),
    });
    const registry: FieldNumberRegistry = new Map([
      ['myapp.v1', existingFieldMap],
    ]);

    const table = makeTable({
      columns: [
        { name: 'role', type: 'userRoleEnum', isNullable: false, isPrimaryKey: false, isUnique: false, isArray: false },
      ],
    });
    // editor removed
    const enums: SchemaEnum[] = [
      { name: 'userRoleEnum', values: ['admin', 'viewer'] },
    ];

    const generator = new ProtoGenerator(makeConfig());
    const result = generator.generateProtoFiles([table], enums, registry);

    const protoEnum = result.get('default')!.enums[0]!;
    expect(protoEnum.reservedNumbers).toEqual([2]);
    expect(protoEnum.reservedNames).toEqual(['USER_ROLE_EDITOR']);
  });
});
