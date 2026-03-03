/**
 * Maps Drizzle ORM types to Protobuf types
 */

import type { SchemaColumn } from '../types.js';

export interface TypeMapping {
  protoType: string;
  needsImport?: string;
}

export interface TypeMapperOptions {
  useGoogleTimestamp?: boolean;
  useGoogleDate?: boolean;
  useGoogleStruct?: boolean;
}

/**
 * A single entry in the substring fallback table.
 * Ordering matters: patterns are checked sequentially via substring match.
 */
interface TypeRule {
  pattern: string;
  resolve: (options: TypeMapperOptions) => TypeMapping;
}

const TIMESTAMP_IMPORT = 'google/protobuf/timestamp.proto';

const resolveTimestamp = (opts: TypeMapperOptions): TypeMapping =>
  opts.useGoogleTimestamp === false
    ? { protoType: 'string' }
    : { protoType: 'google.protobuf.Timestamp', needsImport: TIMESTAMP_IMPORT };

const resolveDate = (opts: TypeMapperOptions): TypeMapping => {
  if (opts.useGoogleDate) {
    return { protoType: 'google.type.Date', needsImport: 'google/type/date.proto' };
  }
  return resolveTimestamp(opts);
};

const resolveJson = (opts: TypeMapperOptions): TypeMapping =>
  opts.useGoogleStruct
    ? { protoType: 'google.protobuf.Struct', needsImport: 'google/protobuf/struct.proto' }
    : { protoType: 'string' };

const toString = () => ({ protoType: 'string' }) as TypeMapping;
const toInt32 = () => ({ protoType: 'int32' }) as TypeMapping;
const toInt64 = () => ({ protoType: 'int64' }) as TypeMapping;
const toFloat = () => ({ protoType: 'float' }) as TypeMapping;
const toDouble = () => ({ protoType: 'double' }) as TypeMapping;
const toBool = () => ({ protoType: 'bool' }) as TypeMapping;
const toBytes = () => ({ protoType: 'bytes' }) as TypeMapping;

/**
 * Exact-match type map. Covers all known Drizzle/PostgreSQL types.
 * O(1) lookup — no ordering concerns.
 */
const EXACT_TYPE_MAP = new Map<string, (opts: TypeMapperOptions) => TypeMapping>([
  // Text
  ['varchar', toString],
  ['text', toString],
  ['char', toString],
  // Integer
  ['bigint', toInt64],
  ['bigserial', toInt64],
  ['smallint', toInt32],
  ['integer', toInt32],
  ['int', toInt32],
  ['serial', toInt32],
  // Float
  ['real', toFloat],
  ['float4', toFloat],
  ['double', toDouble],
  ['float8', toDouble],
  ['numeric', toDouble],
  ['decimal', toDouble],
  // Boolean
  ['bool', toBool],
  ['boolean', toBool],
  // Temporal
  ['timestamp', resolveTimestamp],
  ['timestamptz', resolveTimestamp],
  ['date', resolveDate],
  ['time', resolveTimestamp],
  ['timetz', resolveTimestamp],
  // JSON
  ['json', resolveJson],
  ['jsonb', resolveJson],
  // UUID
  ['uuid', toString],
  // Binary
  ['bytea', toBytes],
  ['blob', toBytes],
  ['binary', toBytes],
  // Network
  ['inet', toString],
  ['cidr', toString],
  ['macaddr', toString],
]);

/**
 * Substring fallback for unknown type variants (e.g. vendor-specific types).
 * Order matters: "timestamp" before "time", etc.
 */
const SUBSTRING_RULES: TypeRule[] = [
  { pattern: 'timestamp', resolve: resolveTimestamp },
  { pattern: 'date', resolve: resolveDate },
  { pattern: 'time', resolve: resolveTimestamp },
  { pattern: 'json', resolve: resolveJson },
  { pattern: 'int', resolve: toInt32 },
  { pattern: 'char', resolve: toString },
  { pattern: 'bool', resolve: toBool },
  { pattern: 'enum', resolve: () => ({ protoType: 'ENUM_PLACEHOLDER' }) },
];

/**
 * Map a schema column type to its Protobuf type.
 * Tries exact match first, then falls back to substring matching.
 */
export function mapColumnTypeToProto(
  column: SchemaColumn,
  options: TypeMapperOptions = {},
): TypeMapping {
  const baseType = column.type.toLowerCase();

  // Exact match (O(1) lookup)
  const exact = EXACT_TYPE_MAP.get(baseType);
  if (exact) return exact(options);

  // Substring fallback for unknown type variants
  for (const rule of SUBSTRING_RULES) {
    if (baseType.includes(rule.pattern)) {
      return rule.resolve(options);
    }
  }

  // Default to string for unknown types
  return { protoType: 'string' };
}

/**
 * Singularize a table name for use as a proto message name.
 *
 * Handles common English plural patterns while avoiding
 * false positives on words that naturally end in 's'.
 */
export function singularize(word: string): string {
  if (!word.endsWith('s') || word.length <= 2) return word;

  // Words ending in 'ss' are not plural (class, address, access, process)
  if (word.endsWith('ss')) return word;

  // Words ending in 'us' are not plural (status, virus, campus, opus)
  if (word.endsWith('us')) return word;

  // Words ending in 'is' are not plural (analysis, basis, thesis)
  if (word.endsWith('is')) return word;

  // -ies -> -y (categories -> category, entries -> entry)
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';

  // -sses -> -ss (dresses -> dress, classes -> class, addresses -> address)
  if (word.endsWith('sses')) return word.slice(0, -2);

  // -shes -> -sh (dishes -> dish, crashes -> crash)
  if (word.endsWith('shes')) return word.slice(0, -2);

  // -ches -> -ch (watches -> watch, batches -> batch)
  if (word.endsWith('ches')) return word.slice(0, -2);

  // -xes -> -x (boxes -> box, indexes -> index)
  if (word.endsWith('xes')) return word.slice(0, -2);

  // -zzes -> -zz (buzzes -> buzz, fizzes -> fizz)
  if (word.endsWith('zzes')) return word.slice(0, -2);

  // -oes -> -o (heroes -> hero, tomatoes -> tomato, potatoes -> potato)
  if (word.endsWith('oes')) return word.slice(0, -2);

  // Default: remove trailing 's'
  return word.slice(0, -1);
}

/**
 * Convert snake_case to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 */
export function camelToSnake(str: string): string {
  return str
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '');
}

/**
 * Convert to PascalCase
 */
export function toPascalCase(str?: string): string {
  if (!str?.length) return '';

  // Handle different input formats
  let result: string;

  if (str.includes('_')) {
    // Handle snake_case input
    result = snakeToCamel(str.toLowerCase());
    result = result.charAt(0).toUpperCase() + result.slice(1);
  } else {
    // Handle camelCase or other inputs
    // First preserve existing word boundaries by converting camelCase to snake_case temporarily
    const withUnderscores = str.replace(/([a-z])([A-Z])/g, '$1_$2');
    // Then convert to proper PascalCase
    result = withUnderscores
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  // Clean up any remaining underscores or spaces
  result = result.replace(/[_\s]/g, '');

  return result;
}

/**
 * Generate proto enum value name
 */
export function generateProtoEnumValue(
  enumName: string,
  value: string,
  prefix?: string,
): string {
  // Use the enum name itself as prefix (converted to UPPER_SNAKE_CASE)
  const titlePrefix = prefix ? prefix.toUpperCase() + '_' : '';
  const enumPrefix = camelToSnake(enumName.replace(/enum$/i, '')).toUpperCase();
  const valueUpper = value.toUpperCase().replace(/-/g, '_');
  return `${titlePrefix}${enumPrefix}_${valueUpper}`;
}

/**
 * Get required imports for a proto file based on field types
 */
export function getRequiredImports(mappings: TypeMapping[]): string[] {
  const imports = new Set<string>();

  for (const mapping of mappings) {
    if (mapping.needsImport) {
      imports.add(mapping.needsImport);
    }
  }

  return Array.from(imports);
}

/**
 * Determine if a field should be optional in proto3
 */
export function shouldBeOptional(column: SchemaColumn): boolean {
  // In proto3, use optional for nullable fields that aren't repeated
  return column.isNullable && !column.isPrimaryKey;
}

/**
 * Generate field comment from column metadata
 */
export function generateFieldComment(
  column: SchemaColumn,
): string | undefined {
  const comments: string[] = [];

  if (column.isPrimaryKey) {
    comments.push('Primary key');
  }

  if (column.isUnique) {
    comments.push('Unique');
  }

  if (column.length) {
    comments.push(`Max length: ${column.length}`);
  }

  if (column.defaultValue !== undefined) {
    comments.push(`Default: ${column.defaultValue}`);
  }

  return comments.length > 0 ? comments.join(', ') : undefined;
}
