import { test, expect, describe } from 'bun:test';
import {
  mapDrizzleTypeToProto,
  snakeToCamel,
  camelToSnake,
  toPascalCase,
  generateProtoEnumValue,
  shouldBeOptional,
  generateFieldComment,
  getRequiredImports,
} from '../src/generator/type-mapper';
import type { DrizzleColumn } from '../src/types';

function makeColumn(overrides: Partial<DrizzleColumn> = {}): DrizzleColumn {
  return {
    name: 'test_col',
    type: 'varchar',
    isNullable: false,
    isPrimaryKey: false,
    isUnique: false,
    isArray: false,
    ...overrides,
  };
}

describe('mapDrizzleTypeToProto', () => {
  test('text types map to string', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'varchar' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'text' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'char' })).protoType).toBe('string');
  });

  test('integer types map to int32', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'integer' })).protoType).toBe('int32');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'serial' })).protoType).toBe('int32');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'smallint' })).protoType).toBe('int32');
  });

  test('bigint maps to int64', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'bigint' })).protoType).toBe('int64');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'bigserial' })).protoType).toBe('int64');
  });

  test('float types', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'real' })).protoType).toBe('float');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'float4' })).protoType).toBe('float');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'double' })).protoType).toBe('double');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'float8' })).protoType).toBe('double');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'numeric' })).protoType).toBe('double');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'decimal' })).protoType).toBe('double');
  });

  test('boolean maps to bool', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'boolean' })).protoType).toBe('bool');
  });

  test('timestamp/date/time map to google.protobuf.Timestamp', () => {
    const ts = mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }));
    expect(ts.protoType).toBe('google.protobuf.Timestamp');
    expect(ts.needsImport).toBe('google/protobuf/timestamp.proto');

    expect(mapDrizzleTypeToProto(makeColumn({ type: 'date' })).protoType).toBe('google.protobuf.Timestamp');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'time' })).protoType).toBe('google.protobuf.Timestamp');
  });

  test('json/jsonb map to string', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'json' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'jsonb' })).protoType).toBe('string');
  });

  test('uuid maps to string', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'uuid' })).protoType).toBe('string');
  });

  test('binary types map to bytes', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'bytea' })).protoType).toBe('bytes');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'blob' })).protoType).toBe('bytes');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'binary' })).protoType).toBe('bytes');
  });

  test('network types map to string', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'inet' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'cidr' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'macaddr' })).protoType).toBe('string');
  });

  test('enum type returns placeholder', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'enum' })).protoType).toBe('ENUM_PLACEHOLDER');
  });

  test('unknown type defaults to string', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'custom_weird_type' })).protoType).toBe('string');
  });
});

describe('snakeToCamel', () => {
  test('converts basic snake_case', () => {
    expect(snakeToCamel('user_name')).toBe('userName');
    expect(snakeToCamel('created_at')).toBe('createdAt');
  });

  test('handles single word', () => {
    expect(snakeToCamel('name')).toBe('name');
  });

  test('handles multiple underscores', () => {
    expect(snakeToCamel('long_column_name_here')).toBe('longColumnNameHere');
  });
});

describe('camelToSnake', () => {
  test('converts basic camelCase', () => {
    expect(camelToSnake('userName')).toBe('user_name');
    expect(camelToSnake('createdAt')).toBe('created_at');
  });

  test('handles single word', () => {
    expect(camelToSnake('name')).toBe('name');
  });

  test('does not add leading underscore', () => {
    expect(camelToSnake('UserName')).toBe('user_name');
  });
});

describe('toPascalCase', () => {
  test('converts snake_case', () => {
    expect(toPascalCase('user_role')).toBe('UserRole');
    expect(toPascalCase('created_at')).toBe('CreatedAt');
  });

  test('converts camelCase', () => {
    expect(toPascalCase('userName')).toBe('UserName');
  });

  test('handles empty/undefined', () => {
    expect(toPascalCase('')).toBe('');
    expect(toPascalCase(undefined)).toBe('');
  });
});

describe('generateProtoEnumValue', () => {
  test('generates value with prefix', () => {
    expect(generateProtoEnumValue('userRole', 'admin', 'PROTO')).toBe('PROTO_USER_ROLE_ADMIN');
  });

  test('generates value without prefix', () => {
    expect(generateProtoEnumValue('userRole', 'admin')).toBe('USER_ROLE_ADMIN');
  });

  test('strips Enum suffix', () => {
    expect(generateProtoEnumValue('userRoleEnum', 'admin')).toBe('USER_ROLE_ADMIN');
  });

  test('handles hyphens in values', () => {
    expect(generateProtoEnumValue('status', 'in-progress')).toBe('STATUS_IN_PROGRESS');
  });
});

describe('shouldBeOptional', () => {
  test('nullable non-PK is optional', () => {
    expect(shouldBeOptional(makeColumn({ isNullable: true, isPrimaryKey: false }))).toBe(true);
  });

  test('non-nullable is not optional', () => {
    expect(shouldBeOptional(makeColumn({ isNullable: false }))).toBe(false);
  });

  test('nullable PK is not optional', () => {
    expect(shouldBeOptional(makeColumn({ isNullable: true, isPrimaryKey: true }))).toBe(false);
  });
});

describe('generateFieldComment', () => {
  test('includes primary key', () => {
    expect(generateFieldComment(makeColumn({ isPrimaryKey: true }))).toBe('Primary key');
  });

  test('includes unique', () => {
    expect(generateFieldComment(makeColumn({ isUnique: true }))).toBe('Unique');
  });

  test('includes max length', () => {
    expect(generateFieldComment(makeColumn({ length: 255 }))).toBe('Max length: 255');
  });

  test('combines multiple comments', () => {
    expect(generateFieldComment(makeColumn({ isPrimaryKey: true, isUnique: true }))).toBe('Primary key, Unique');
  });

  test('returns undefined for no metadata', () => {
    expect(generateFieldComment(makeColumn())).toBeUndefined();
  });
});

describe('getRequiredImports', () => {
  test('collects unique imports', () => {
    const mappings = [
      { protoType: 'google.protobuf.Timestamp', needsImport: 'google/protobuf/timestamp.proto' },
      { protoType: 'string' },
      { protoType: 'google.protobuf.Timestamp', needsImport: 'google/protobuf/timestamp.proto' },
    ];
    expect(getRequiredImports(mappings)).toEqual(['google/protobuf/timestamp.proto']);
  });

  test('returns empty for no imports', () => {
    expect(getRequiredImports([{ protoType: 'string' }, { protoType: 'int32' }])).toEqual([]);
  });
});
