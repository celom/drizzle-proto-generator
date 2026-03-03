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

export class ProtoGenerator {
  private config: GeneratorConfig;
  private enumMap: Map<string, DrizzleEnum>;
  private enumUsageMap: Map<string, EnumUsage>;

  constructor(config: GeneratorConfig) {
    this.config = {
      options: {
        useGoogleTimestamp: true,
        enumPrefix: '',
        addUnspecified: true,
        preserveSnakeCase: false,
        generateComments: true,
        ...config.options,
      },
      ...config,
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
      const commonProtoFile = this.generateCommonProtoFile(commonEnums);
      protoFiles.set('common', commonProtoFile);
    }

    // Generate a proto file for each schema
    for (const [schemaName, schemaTables] of tablesBySchema.entries()) {
      const protoFile = this.generateProtoFile(
        schemaName,
        schemaTables,
        enums,
        commonEnums,
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
  private generateCommonProtoFile(commonEnums: DrizzleEnum[]): ProtoFile {
    const enums: ProtoEnum[] = commonEnums.map((drizzleEnum) =>
      this.enumToProtoEnum(drizzleEnum),
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
  ): ProtoFile {
    const messages: ProtoMessage[] = [];
    const enums: ProtoEnum[] = [];
    const imports = new Set<string>();
    const usedEnums = new Set<string>();

    // Convert tables to messages
    for (const table of tables) {
      const message = this.tableToMessage(table, commonEnums);
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
          const protoEnum = this.enumToProtoEnum(drizzleEnum);
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
  ): ProtoMessage {
    const fields: ProtoField[] = [];
    let fieldNumber = 1;

    for (const column of table.columns) {
      const field = this.columnToField(column, fieldNumber++, commonEnums);
      if (field) {
        fields.push(field);
      }
    }

    // Generate message name from table name (singularized)
    const messageName = toPascalCase(singularize(table.name));

    return {
      name: messageName,
      fields,
      comment: this.config.options?.generateComments
        ? `Message for ${table.name} table`
        : undefined,
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
    const fieldName = this.config.options?.preserveSnakeCase
      ? column.name
      : snakeToCamel(column.name);

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
  private enumToProtoEnum(drizzleEnum: DrizzleEnum): ProtoEnum {
    const values: { name: string; number: number }[] = [];

    // Add UNSPECIFIED value at 0 if configured
    if (this.config.options?.addUnspecified) {
      const unspecifiedName = generateProtoEnumValue(
        drizzleEnum.name,
        'UNSPECIFIED',
        this.config.options?.enumPrefix,
      );
      values.push({ name: unspecifiedName, number: 0 });
    }

    // Add enum values
    drizzleEnum.values.forEach((value, index) => {
      const valueName = generateProtoEnumValue(
        drizzleEnum.name,
        value,
        this.config.options?.enumPrefix,
      );
      const valueNumber = this.config.options?.addUnspecified
        ? index + 1
        : index;
      values.push({ name: valueName, number: valueNumber });
    });

    return {
      name: this.getProtoEnumName(drizzleEnum.name),
      values,
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
