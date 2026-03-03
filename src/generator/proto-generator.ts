/**
 * Generate Protobuf definitions from parsed Drizzle schemas
 */

import type {
  DrizzleTable,
  DrizzleColumn,
  DrizzleEnum,
  ProtoMessage,
  ProtoEnum,
  ProtoField,
  ProtoFile,
  GeneratorConfig,
  ExistingFieldMap,
  FieldNumberRegistry,
} from '../types.js';
import {
  mapDrizzleTypeToProto,
  singularize,
  snakeToCamel,
  toPascalCase,
  generateProtoEnumValue,
  shouldBeOptional,
  generateFieldComment,
} from './type-mapper.js';
import type { TypeMapping } from './type-mapper.js';

interface EnumUsage {
  enum: DrizzleEnum;
  schemas: Set<string>;
}

/**
 * Find the next available field/value number, skipping used numbers
 * and the protobuf reserved range 19000-19999.
 */
function nextAvailableNumber(
  usedNumbers: Set<number>,
  startFrom = 1,
): number {
  let n = startFrom;
  while (usedNumbers.has(n) || (n >= 19000 && n <= 19999)) {
    n++;
  }
  return n;
}

export class ProtoGenerator {
  private config: GeneratorConfig;
  private enumMap: Map<string, DrizzleEnum>;
  private enumUsageMap: Map<string, EnumUsage>;

  constructor(config: GeneratorConfig) {
    this.config = {
      ...config,
      options: {
        useGoogleTimestamp: true,
        useGoogleDate: false,
        useGoogleStruct: false,
        enumPrefix: '',
        addUnspecified: true,
        useCamelCase: false,
        generateComments: true,
        ...config.options,
      },
    };
    this.enumMap = new Map();
    this.enumUsageMap = new Map();
  }

  /**
   * Generate proto files from parsed schemas
   */
  generateProtoFiles(
    tables: DrizzleTable[],
    enums: DrizzleEnum[],
    registry?: FieldNumberRegistry,
  ): Map<string, ProtoFile> {
    // Build enum map for reference
    enums.forEach((e) => this.enumMap.set(e.name, e));

    // Analyze enum usage across schemas to identify common types
    this.analyzeEnumUsage(tables);

    // Group tables by schema
    const tablesBySchema = this.groupTablesBySchema(tables);
    const protoFiles = new Map<string, ProtoFile>();

    // Generate common proto file if there are shared enums
    const commonEnums = this.getCommonEnums();
    if (commonEnums.length > 0) {
      const commonPackage = this.buildCommonPackageName();
      const existingFieldMap = registry?.get(commonPackage);
      const commonProtoFile = this.generateCommonProtoFile(
        commonEnums,
        existingFieldMap,
      );
      protoFiles.set('common', commonProtoFile);
    }

    // Generate a proto file for each schema
    for (const [schemaName, schemaTables] of tablesBySchema.entries()) {
      const packageName = this.buildPackageName(schemaName);
      const existingFieldMap = registry?.get(packageName);
      const protoFile = this.generateProtoFile(
        schemaName,
        schemaTables,
        enums,
        commonEnums,
        existingFieldMap,
      );
      protoFiles.set(schemaName, protoFile);
    }

    return protoFiles;
  }

  /**
   * Resolve a column type to its enum name if it references a known enum.
   * Returns the enum name or null if not an enum.
   */
  private resolveEnumName(columnType: string): string | null {
    // Direct match (e.g., 'userRoleEnum' or 'role')
    if (this.enumMap.has(columnType)) {
      return columnType;
    }

    // Strip 'Enum'/'enum' suffix and try again (e.g., 'userRoleEnum' -> 'userRole')
    const stripped = columnType.replace(/enum$/i, '');
    if (stripped !== columnType && this.enumMap.has(stripped)) {
      return stripped;
    }

    return null;
  }

  /**
   * Analyze enum usage across all tables to identify common types
   */
  private analyzeEnumUsage(tables: DrizzleTable[]): void {
    this.enumUsageMap.clear();

    for (const table of tables) {
      const schemaName = table.schema || 'default';

      for (const column of table.columns) {
        const enumName = this.resolveEnumName(column.type);
        if (!enumName) continue;

        const drizzleEnum = this.enumMap.get(enumName)!;

        if (!this.enumUsageMap.has(enumName)) {
          this.enumUsageMap.set(enumName, {
            enum: drizzleEnum,
            schemas: new Set(),
          });
        }

        this.enumUsageMap.get(enumName)!.schemas.add(schemaName);
      }
    }
  }

  /**
   * Get enums that are used in multiple schemas (common enums)
   */
  private getCommonEnums(): DrizzleEnum[] {
    return Array.from(this.enumUsageMap.values())
      .filter((usage) => usage.schemas.size > 1)
      .map((usage) => usage.enum);
  }

  /**
   * Generate the common proto file containing shared enums
   */
  private generateCommonProtoFile(
    commonEnums: DrizzleEnum[],
    existingFieldMap?: ExistingFieldMap,
  ): ProtoFile {
    const enums: ProtoEnum[] = commonEnums.map((drizzleEnum) =>
      this.enumToProtoEnum(drizzleEnum, existingFieldMap),
    );

    const packageName = this.buildCommonPackageName();

    return {
      syntax: 'proto3',
      package: packageName,
      imports: [],
      enums,
      messages: [],
    };
  }

  /**
   * Generate a single proto file
   */
  private generateProtoFile(
    schemaName: string,
    tables: DrizzleTable[],
    allEnums: DrizzleEnum[],
    commonEnums: DrizzleEnum[] = [],
    existingFieldMap?: ExistingFieldMap,
  ): ProtoFile {
    const messages: ProtoMessage[] = [];
    const enums: ProtoEnum[] = [];
    const imports = new Set<string>();
    const usedEnums = new Set<string>();

    // Convert tables to messages
    for (const table of tables) {
      const message = this.tableToMessage(table, commonEnums, existingFieldMap);
      messages.push(message);

      // Track which enums are used
      for (const column of table.columns) {
        const enumName = this.resolveEnumName(column.type);
        if (enumName) {
          usedEnums.add(enumName);
        }
      }

      // Collect imports
      for (const field of message.fields) {
        if (field.type.includes('google.protobuf')) {
          if (field.type.includes('Timestamp')) {
            imports.add('google/protobuf/timestamp.proto');
          } else if (field.type.includes('Struct')) {
            imports.add('google/protobuf/struct.proto');
          } else if (field.type.includes('Any')) {
            imports.add('google/protobuf/any.proto');
          }
        } else if (field.type.includes('google.type')) {
          if (field.type.includes('Date')) {
            imports.add('google/type/date.proto');
          }
        }
      }
    }

    // Add imports for common enums if they are used
    const commonEnumNames = new Set(commonEnums.map((e) => e.name));
    const hasCommonEnumUsage = Array.from(usedEnums).some((enumName) =>
      commonEnumNames.has(enumName),
    );

    if (hasCommonEnumUsage && commonEnums.length > 0) {
      const commonImportPath = this.buildCommonImportPath();
      imports.add(commonImportPath);
    }

    // Add only schema-specific enums to the proto file (exclude common ones)
    for (const enumName of usedEnums) {
      if (!commonEnumNames.has(enumName)) {
        const drizzleEnum = this.enumMap.get(enumName);
        if (drizzleEnum) {
          const protoEnum = this.enumToProtoEnum(drizzleEnum, existingFieldMap);
          enums.push(protoEnum);
        }
      }
    }

    // Build package name
    const packageName = this.buildPackageName(schemaName);

    return {
      syntax: 'proto3',
      package: packageName,
      imports: Array.from(imports),
      enums,
      messages,
    };
  }

  /**
   * Convert a Drizzle table to a Proto message
   */
  private tableToMessage(
    table: DrizzleTable,
    commonEnums: DrizzleEnum[] = [],
    existingFieldMap?: ExistingFieldMap,
  ): ProtoMessage {
    // Generate message name from table name (singularized)
    const messageName = toPascalCase(singularize(table.name));

    const existingFields = existingFieldMap?.messages.get(messageName);
    const existingReservedNumbers =
      existingFieldMap?.messageReservedNumbers.get(messageName) || [];
    const existingReservedNames =
      existingFieldMap?.messageReservedNames.get(messageName) || [];

    const fields: ProtoField[] = [];
    const usedNumbers = new Set<number>();

    // Collect already-used numbers from existing fields + existing reservations
    if (existingFields) {
      for (const num of existingFields.values()) {
        usedNumbers.add(num);
      }
    }
    for (const num of existingReservedNumbers) {
      usedNumbers.add(num);
    }

    // Track which existing field names are still present
    const currentFieldNames = new Set<string>();

    for (const column of table.columns) {
      const fieldName = this.config.options?.useCamelCase
        ? snakeToCamel(column.name)
        : column.name;
      currentFieldNames.add(fieldName);

      // Determine field number: preserve existing or assign next available
      let fieldNumber: number;
      if (existingFields?.has(fieldName)) {
        fieldNumber = existingFields.get(fieldName)!;
      } else {
        fieldNumber = nextAvailableNumber(usedNumbers);
      }
      usedNumbers.add(fieldNumber);

      const field = this.columnToField(column, fieldNumber, commonEnums);
      if (field) {
        fields.push(field);
      }
    }

    // Compute reserved entries: carry forward existing + add newly removed fields
    const reservedNumbers = [...existingReservedNumbers];
    const reservedNames = [...existingReservedNames];

    if (existingFields) {
      for (const [name, number] of existingFields.entries()) {
        if (!currentFieldNames.has(name)) {
          if (!reservedNumbers.includes(number)) {
            reservedNumbers.push(number);
          }
          if (!reservedNames.includes(name)) {
            reservedNames.push(name);
          }
        }
      }
    }

    return {
      name: messageName,
      fields,
      comment: this.config.options?.generateComments
        ? `Message for ${table.name} table`
        : undefined,
      reservedNumbers:
        reservedNumbers.length > 0
          ? reservedNumbers.sort((a, b) => a - b)
          : undefined,
      reservedNames:
        reservedNames.length > 0 ? reservedNames.sort() : undefined,
    };
  }

  /**
   * Convert a Drizzle column to a Proto field
   */
  private columnToField(
    column: DrizzleColumn,
    fieldNumber: number,
    commonEnums: DrizzleEnum[] = [],
  ): ProtoField | null {
    let typeMapping: TypeMapping;

    // Check if this is an enum column using unified resolution
    const enumName = this.resolveEnumName(column.type);
    if (enumName) {
      const protoEnumName = this.getProtoEnumName(enumName);
      const isCommonEnum = commonEnums.some((e) => e.name === enumName);
      const finalEnumName = isCommonEnum
        ? `${this.buildCommonPackageName()}.${protoEnumName}`
        : protoEnumName;
      typeMapping = { protoType: finalEnumName };
    } else {
      // Use standard type mapping
      typeMapping = mapDrizzleTypeToProto(column, {
        useGoogleTimestamp: this.config.options?.useGoogleTimestamp,
        useGoogleDate: this.config.options?.useGoogleDate,
        useGoogleStruct: this.config.options?.useGoogleStruct,
      });

      // Handle enum types from type mapping (fallback for 'enum' in type name)
      if (typeMapping.protoType === 'ENUM_PLACEHOLDER') {
        const fallbackEnumName = column.type.replace(/enum$/i, '');
        if (this.enumMap.has(fallbackEnumName)) {
          const protoEnumName = this.getProtoEnumName(fallbackEnumName);
          const isCommonEnum = commonEnums.some(
            (e) => e.name === fallbackEnumName,
          );
          const finalEnumName = isCommonEnum
            ? `${this.buildCommonPackageName()}.${protoEnumName}`
            : protoEnumName;
          typeMapping = { protoType: finalEnumName };
        } else {
          // Fallback to string if enum not found
          typeMapping = { protoType: 'string' };
        }
      }
    }

    // Convert field name
    const fieldName = this.config.options?.useCamelCase
      ? snakeToCamel(column.name)
      : column.name;

    return {
      name: fieldName,
      type: typeMapping.protoType,
      number: fieldNumber,
      optional: shouldBeOptional(column),
      repeated: column.isArray,
      comment: this.config.options?.generateComments
        ? generateFieldComment(column)
        : undefined,
    };
  }

  /**
   * Convert a Drizzle enum to a Proto enum
   */
  private enumToProtoEnum(
    drizzleEnum: DrizzleEnum,
    existingFieldMap?: ExistingFieldMap,
  ): ProtoEnum {
    const protoEnumName = this.getProtoEnumName(drizzleEnum.name);
    const existingValues = existingFieldMap?.enums.get(protoEnumName);
    const existingReservedNumbers =
      existingFieldMap?.enumReservedNumbers.get(protoEnumName) || [];
    const existingReservedNames =
      existingFieldMap?.enumReservedNames.get(protoEnumName) || [];

    const values: { name: string; number: number }[] = [];
    const usedNumbers = new Set<number>();
    const currentValueNames = new Set<string>();

    // Collect used numbers from existing values + reservations
    if (existingValues) {
      for (const num of existingValues.values()) {
        usedNumbers.add(num);
      }
    }
    for (const num of existingReservedNumbers) {
      usedNumbers.add(num);
    }

    // Add UNSPECIFIED value at 0 if configured
    if (this.config.options?.addUnspecified) {
      const unspecifiedName = generateProtoEnumValue(
        drizzleEnum.name,
        'UNSPECIFIED',
        this.config.options?.enumPrefix,
      );
      currentValueNames.add(unspecifiedName);
      const number = existingValues?.get(unspecifiedName) ?? 0;
      usedNumbers.add(number);
      values.push({ name: unspecifiedName, number });
    }

    // Add enum values
    for (const value of drizzleEnum.values) {
      const valueName = generateProtoEnumValue(
        drizzleEnum.name,
        value,
        this.config.options?.enumPrefix,
      );
      currentValueNames.add(valueName);

      let valueNumber: number;
      if (existingValues?.has(valueName)) {
        valueNumber = existingValues.get(valueName)!;
      } else {
        // Enum values start at 0 when UNSPECIFIED is not added
        const startFrom = this.config.options?.addUnspecified ? 1 : 0;
        valueNumber = nextAvailableNumber(usedNumbers, startFrom);
      }
      usedNumbers.add(valueNumber);
      values.push({ name: valueName, number: valueNumber });
    }

    // Compute reserved entries for removed values
    const reservedNumbers = [...existingReservedNumbers];
    const reservedNames = [...existingReservedNames];

    if (existingValues) {
      for (const [name, number] of existingValues.entries()) {
        if (!currentValueNames.has(name)) {
          if (!reservedNumbers.includes(number)) {
            reservedNumbers.push(number);
          }
          if (!reservedNames.includes(name)) {
            reservedNames.push(name);
          }
        }
      }
    }

    return {
      name: protoEnumName,
      values,
      reservedNumbers:
        reservedNumbers.length > 0
          ? reservedNumbers.sort((a, b) => a - b)
          : undefined,
      reservedNames:
        reservedNames.length > 0 ? reservedNames.sort() : undefined,
    };
  }

  /**
   * Get full Proto enum name (with prefix if configured)
   */
  private getProtoEnumName(enumName: string): string {
    const enumNamePrefix = toPascalCase(this.config.options?.enumPrefix || '');
    const baseName = toPascalCase(enumName.replace(/enum$/i, ''));
    return enumNamePrefix + baseName;
  }

  /**
   * Group tables by schema
   */
  private groupTablesBySchema(
    tables: DrizzleTable[],
  ): Map<string, DrizzleTable[]> {
    const grouped = new Map<string, DrizzleTable[]>();

    for (const table of tables) {
      const schema = table.schema || 'default';
      if (!grouped.has(schema)) {
        grouped.set(schema, []);
      }
      grouped.get(schema)!.push(table);
    }

    return grouped;
  }

  /**
   * Build package name from schema name
   */
  private buildPackageName(schemaName: string): string {
    const base = this.config.protoPackageName || 'proto';
    const cleanSchema = schemaName
      .replace(/_schema$/i, '')
      .replace(/_/g, '.')
      .toLowerCase();

    if (schemaName === 'default') {
      return `${base}.v1`;
    }

    return `${base}.${cleanSchema}.v1`;
  }

  /**
   * Build package name for common proto file
   */
  private buildCommonPackageName(): string {
    const base = this.config.protoPackageName || 'proto';
    return `${base}.common.v1`;
  }

  /**
   * Build import path for common proto file
   */
  private buildCommonImportPath(): string {
    const base = this.config.protoPackageName || 'proto';
    return `${base}/common/v1/gen_types.proto`;
  }
}
