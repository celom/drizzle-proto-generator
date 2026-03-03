/**
 * Type definitions for the proto generator
 */

export interface SchemaColumn {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isArray: boolean;
  defaultValue?: unknown;
  length?: number;
}

export interface SchemaEnum {
  name: string;
  values: string[];
}

export interface SchemaTable {
  name: string;
  schema?: string;
  columns: SchemaColumn[];
  indexes?: string[];
}

export type PackageResolvers = Record<string, string>;

export interface ProtoField {
  name: string;
  type: string;
  number: number;
  optional: boolean;
  repeated: boolean;
  comment?: string;
}

export interface ProtoEnum {
  name: string;
  values: { name: string; number: number }[];
  reservedNumbers?: number[];
  reservedNames?: string[];
}

export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  comment?: string;
  reservedNumbers?: number[];
  reservedNames?: string[];
}

export interface ProtoFile {
  syntax: string;
  package: string;
  imports: string[];
  enums: ProtoEnum[];
  messages: ProtoMessage[];
}

export interface GeneratorConfig {
  // Path to your Drizzle schema files
  inputPath: string;
  // Output directory for generated proto files
  outputPath: string;
  // Package resolvers for type extraction
  packageResolvers?: PackageResolvers;
  // Base package name for proto files
  protoPackageName: string;
  options?: {
    // Use google.protobuf.Timestamp for timestamp/time fields
    useGoogleTimestamp?: boolean;
    // Use google.type.Date for date fields (overrides useGoogleTimestamp for date)
    useGoogleDate?: boolean;
    // Use google.protobuf.Struct for json/jsonb fields
    useGoogleStruct?: boolean;
    // Prefix for enum values (empty to use enum name as prefix per style guide)
    enumPrefix?: string;
    // Add UNSPECIFIED as the first enum value
    addUnspecified?: boolean;
    // Use camelCase for field names instead of snake_case (proto style guide recommends snake_case)
    useCamelCase?: boolean;
    // Generate comments in proto files
    generateComments?: boolean;
    // Skip reading previous proto files, assign field numbers sequentially
    fresh?: boolean;
  };
}

export interface GenerationResult {
  tableCount: number;
  enumCount: number;
  declaredSchemaCount: number;
  fileCount: number;
  writtenFiles: string[];
}

export interface ParsedSchema {
  tables: SchemaTable[];
  enums: SchemaEnum[];
  schemas: string[];
}

/**
 * Interface defining the contract between a schema parser and the proto
 * generation pipeline. Any ORM or schema tool can implement this to
 * produce proto definitions.
 */
export interface SchemaParser {
  parseSchemas(inputPath: string): Promise<ParsedSchema>;
}

/**
 * Represents field/enum number assignments from a previously generated proto file
 */
export interface ExistingFieldMap {
  /** message name → field name → field number */
  messages: Map<string, Map<string, number>>;
  /** enum name → value name → value number */
  enums: Map<string, Map<string, number>>;
  /** message name → reserved field numbers */
  messageReservedNumbers: Map<string, number[]>;
  /** message name → reserved field names */
  messageReservedNames: Map<string, string[]>;
  /** enum name → reserved value numbers */
  enumReservedNumbers: Map<string, number[]>;
  /** enum name → reserved value names */
  enumReservedNames: Map<string, string[]>;
}

/** package name → ExistingFieldMap */
export type FieldNumberRegistry = Map<string, ExistingFieldMap>;
