/**
 * Type definitions for the proto generator
 */

export interface DrizzleColumn {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isArray: boolean;
  defaultValue?: unknown;
  length?: number;
}

export interface DrizzleEnum {
  name: string;
  values: string[];
}

export interface DrizzleTable {
  name: string;
  schema?: string;
  columns: DrizzleColumn[];
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
}

export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  comment?: string;
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
    // Preserve snake_case in field names (per protobuf style guide)
    preserveSnakeCase?: boolean;
    // Generate comments in proto files
    generateComments?: boolean;
  };
}

export interface GenerationResult {
  tableCount: number;
  enumCount: number;
  schemaCount: number;
  fileCount: number;
  writtenFiles: string[];
}

export interface ParsedSchema {
  tables: DrizzleTable[];
  enums: DrizzleEnum[];
  schemas: string[];
}
