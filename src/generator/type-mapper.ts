/**
 * Maps Drizzle ORM types to Protobuf types
 */

import type { DrizzleColumn } from '../types.js';

export interface TypeMapping {
  protoType: string;
  needsImport?: string;
}

export interface TypeMapperOptions {
  useGoogleTimestamp?: boolean;
}

/**
 * Map Drizzle column type to Protobuf type
 */
export function mapDrizzleTypeToProto(
  column: DrizzleColumn,
  options: TypeMapperOptions = {},
): TypeMapping {
  const baseType = column.type.toLowerCase();

  // Text types
  if (
    baseType.includes('varchar') ||
    baseType.includes('text') ||
    baseType.includes('char')
  ) {
    return { protoType: 'string' };
  }

  // Integer types
  if (
    baseType.includes('int') ||
    baseType.includes('integer') ||
    baseType.includes('serial')
  ) {
    if (baseType.includes('big')) {
      return { protoType: 'int64' };
    }
    if (baseType.includes('small')) {
      return { protoType: 'int32' };
    }
    return { protoType: 'int32' };
  }

  // Floating point types
  if (baseType.includes('real') || baseType.includes('float4')) {
    return { protoType: 'float' };
  }

  if (
    baseType.includes('double') ||
    baseType.includes('float8') ||
    baseType.includes('numeric') ||
    baseType.includes('decimal')
  ) {
    return { protoType: 'double' };
  }

  // Boolean type
  if (baseType.includes('bool') || baseType.includes('boolean')) {
    return { protoType: 'bool' };
  }

  // Date/Time types
  if (
    baseType.includes('timestamp') ||
    baseType.includes('date') ||
    baseType.includes('time')
  ) {
    if (options.useGoogleTimestamp === false) {
      return { protoType: 'string' };
    }
    return {
      protoType: 'google.protobuf.Timestamp',
      needsImport: 'google/protobuf/timestamp.proto',
    };
  }

  // JSON type
  if (baseType.includes('json') || baseType.includes('jsonb')) {
    return { protoType: 'string' };
  }

  // UUID type
  if (baseType.includes('uuid')) {
    return { protoType: 'string' };
  }

  // Binary types
  if (
    baseType.includes('bytea') ||
    baseType.includes('blob') ||
    baseType.includes('binary')
  ) {
    return { protoType: 'bytes' };
  }

  // Network types
  if (
    baseType.includes('inet') ||
    baseType.includes('cidr') ||
    baseType.includes('macaddr')
  ) {
    return { protoType: 'string' };
  }

  // Enum type (will be handled separately)
  if (baseType.includes('enum')) {
    // The actual enum name will be extracted from the schema
    return { protoType: 'ENUM_PLACEHOLDER' };
  }

  // Default to string for unknown types
  console.warn(`Unknown Drizzle type: ${column.type}, defaulting to string`);
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
export function shouldBeOptional(column: DrizzleColumn): boolean {
  // In proto3, use optional for nullable fields that aren't repeated
  return column.isNullable && !column.isPrimaryKey;
}

/**
 * Generate field comment from column metadata
 */
export function generateFieldComment(
  column: DrizzleColumn,
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
