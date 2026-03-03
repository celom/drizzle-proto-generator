import { test, expect, describe } from 'bun:test';
import {
  mapDrizzleTypeToProto,
  singularize,
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

  test('timestamp/date/time map to google.protobuf.Timestamp by default', () => {
    const ts = mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }));
    expect(ts.protoType).toBe('google.protobuf.Timestamp');
    expect(ts.needsImport).toBe('google/protobuf/timestamp.proto');

    expect(mapDrizzleTypeToProto(makeColumn({ type: 'date' })).protoType).toBe('google.protobuf.Timestamp');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'time' })).protoType).toBe('google.protobuf.Timestamp');
  });

  test('date maps to google.type.Date when useGoogleDate is true', () => {
    const opts = { useGoogleDate: true };
    const result = mapDrizzleTypeToProto(makeColumn({ type: 'date' }), opts);
    expect(result.protoType).toBe('google.type.Date');
    expect(result.needsImport).toBe('google/type/date.proto');
  });

  test('date maps to google.type.Date even when useGoogleTimestamp is false', () => {
    const opts = { useGoogleTimestamp: false, useGoogleDate: true };
    const result = mapDrizzleTypeToProto(makeColumn({ type: 'date' }), opts);
    expect(result.protoType).toBe('google.type.Date');
    expect(result.needsImport).toBe('google/type/date.proto');
  });

  test('useGoogleDate does not affect timestamp or time types', () => {
    const opts = { useGoogleDate: true };
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }), opts).protoType).toBe('google.protobuf.Timestamp');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'time' }), opts).protoType).toBe('google.protobuf.Timestamp');
  });

  test('json/jsonb map to string by default', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'json' })).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'jsonb' })).protoType).toBe('string');
  });

  test('json/jsonb map to google.protobuf.Struct when useGoogleStruct is true', () => {
    const opts = { useGoogleStruct: true };
    const jsonResult = mapDrizzleTypeToProto(makeColumn({ type: 'json' }), opts);
    expect(jsonResult.protoType).toBe('google.protobuf.Struct');
    expect(jsonResult.needsImport).toBe('google/protobuf/struct.proto');

    const jsonbResult = mapDrizzleTypeToProto(makeColumn({ type: 'jsonb' }), opts);
    expect(jsonbResult.protoType).toBe('google.protobuf.Struct');
    expect(jsonbResult.needsImport).toBe('google/protobuf/struct.proto');
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

  test('timestamp/date/time map to string when useGoogleTimestamp is false', () => {
    const opts = { useGoogleTimestamp: false };
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }), opts).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'date' }), opts).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'time' }), opts).protoType).toBe('string');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }), opts).needsImport).toBeUndefined();
  });

  test('timestamp maps to google.protobuf.Timestamp by default', () => {
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' })).protoType).toBe('google.protobuf.Timestamp');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }), {}).protoType).toBe('google.protobuf.Timestamp');
    expect(mapDrizzleTypeToProto(makeColumn({ type: 'timestamp' }), { useGoogleTimestamp: true }).protoType).toBe('google.protobuf.Timestamp');
  });
});

describe('singularize', () => {
  test('removes trailing s from regular plurals', () => {
    expect(singularize('users')).toBe('user');
    expect(singularize('posts')).toBe('post');
    expect(singularize('accounts')).toBe('account');
    expect(singularize('sessions')).toBe('session');
    expect(singularize('invoices')).toBe('invoice');
    expect(singularize('members')).toBe('member');
    expect(singularize('orders')).toBe('order');
    expect(singularize('events')).toBe('event');
    expect(singularize('products')).toBe('product');
    expect(singularize('messages')).toBe('message');
  });

  test('does not singularize words ending in ss', () => {
    expect(singularize('status')).toBe('status');
    expect(singularize('address')).toBe('address');
    expect(singularize('access')).toBe('access');
    expect(singularize('process')).toBe('process');
  });

  test('does not singularize words ending in us', () => {
    expect(singularize('status')).toBe('status');
    expect(singularize('campus')).toBe('campus');
  });

  test('does not singularize words ending in is', () => {
    expect(singularize('analysis')).toBe('analysis');
    expect(singularize('basis')).toBe('basis');
  });

  test('handles -ies -> -y', () => {
    expect(singularize('categories')).toBe('category');
    expect(singularize('entries')).toBe('entry');
    expect(singularize('policies')).toBe('policy');
  });

  test('handles -sses -> -ss', () => {
    expect(singularize('addresses')).toBe('address');
    expect(singularize('classes')).toBe('class');
    expect(singularize('processes')).toBe('process');
  });

  test('handles -shes -> -sh', () => {
    expect(singularize('crashes')).toBe('crash');
    expect(singularize('dishes')).toBe('dish');
  });

  test('handles -ches -> -ch', () => {
    expect(singularize('watches')).toBe('watch');
    expect(singularize('batches')).toBe('batch');
  });

  test('handles -xes -> -x', () => {
    expect(singularize('boxes')).toBe('box');
    expect(singularize('indexes')).toBe('index');
    expect(singularize('taxes')).toBe('tax');
  });

  test('does not modify words without trailing s', () => {
    expect(singularize('user')).toBe('user');
    expect(singularize('data')).toBe('data');
  });

  test('does not modify short words', () => {
    expect(singularize('is')).toBe('is');
    expect(singularize('us')).toBe('us');
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
