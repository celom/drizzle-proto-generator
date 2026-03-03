/**
 * Main entry point for the proto generator
 */

import { DrizzleSchemaParser } from './parser/drizzle-parser.js';
import { ProtoGenerator } from './generator/proto-generator.js';
import { ProtoWriter } from './generator/proto-writer.js';
import { ProtoReader } from './reader/proto-reader.js';
import type {
  GeneratorConfig,
  GenerationResult,
  FieldNumberRegistry,
  SchemaParser,
} from './types.js';

export class ProtoGenRunner {
  private config: GeneratorConfig;
  private parser: SchemaParser;
  private generator: ProtoGenerator;
  private writer: ProtoWriter;
  private reader: ProtoReader;

  constructor(config: GeneratorConfig) {
    this.config = config;
    this.parser = new DrizzleSchemaParser({
      packageResolvers: config.packageResolvers,
    });
    this.generator = new ProtoGenerator(config);
    this.writer = new ProtoWriter();
    this.reader = new ProtoReader();
  }

  /**
   * Run the proto generation process
   */
  async run(): Promise<GenerationResult> {
    const parsedSchema = await this.parser.parseSchemas(this.config.inputPath);

    // Read existing proto files for field number stability
    let registry: FieldNumberRegistry | undefined;
    if (!this.config.options?.fresh) {
      try {
        registry = await this.reader.readExistingProtos(
          this.config.outputPath,
        );
        if (registry.size === 0) {
          registry = undefined;
        }
      } catch {
        // Output directory doesn't exist yet — first run
        registry = undefined;
      }
    }

    const protoFiles = this.generator.generateProtoFiles(
      parsedSchema.tables,
      parsedSchema.enums,
      registry,
    );

    const writtenFiles = await this.writer.writeProtoFiles(
      protoFiles,
      this.config.outputPath,
    );

    return {
      tableCount: parsedSchema.tables.length,
      enumCount: parsedSchema.enums.length,
      declaredSchemaCount: parsedSchema.schemas.length,
      fileCount: protoFiles.size,
      writtenFiles,
    };
  }
}

// Export all types and utilities
export * from './types.js';
export * from './parser/drizzle-parser.js';
export * from './generator/proto-generator.js';
export * from './generator/proto-writer.js';
export * from './generator/type-mapper.js';
export * from './reader/proto-reader.js';
