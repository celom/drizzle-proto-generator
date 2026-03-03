/**
 * Main entry point for the proto generator
 */

import { DrizzleSchemaParser } from './parser/drizzle-parser.js';
import { ProtoGenerator } from './generator/proto-generator.js';
import { ProtoWriter } from './generator/proto-writer.js';
import type { GeneratorConfig, GenerationResult } from './types.js';

export class ProtoGenRunner {
  private config: GeneratorConfig;
  private parser: DrizzleSchemaParser;
  private generator: ProtoGenerator;
  private writer: ProtoWriter;

  constructor(config: GeneratorConfig) {
    this.config = config;
    this.parser = new DrizzleSchemaParser({
      packageResolvers: config.packageResolvers,
    });
    this.generator = new ProtoGenerator(config);
    this.writer = new ProtoWriter();
  }

  /**
   * Run the proto generation process
   */
  async run(): Promise<GenerationResult> {
    const parsedSchema = await this.parser.parseSchemas(this.config.inputPath);

    const protoFiles = this.generator.generateProtoFiles(
      parsedSchema.tables,
      parsedSchema.enums,
    );

    const writtenFiles = await this.writer.writeProtoFiles(
      protoFiles,
      this.config.outputPath,
    );

    return {
      tableCount: parsedSchema.tables.length,
      enumCount: parsedSchema.enums.length,
      schemaCount: parsedSchema.schemas.length,
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
