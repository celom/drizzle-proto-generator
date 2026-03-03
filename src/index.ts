/**
 * Main entry point for the proto generator
 */

import { DrizzleSchemaParser } from './parser/drizzle-parser.js';
import { ProtoGenerator } from './generator/proto-generator.js';
import { ProtoWriter } from './generator/proto-writer.js';
import type { GeneratorConfig } from './types.js';

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
  async run(): Promise<void> {
    // Step 1: Parse Drizzle schemas
    console.log('📖 Parsing Drizzle schemas...');
    const parsedSchema = await this.parser.parseSchemas(this.config.inputPath);

    console.log(`  Found ${parsedSchema.tables.length} tables`);
    console.log(`  Found ${parsedSchema.enums.length} enums`);
    console.log(`  Found ${parsedSchema.schemas.length} schemas`);

    // Step 2: Generate proto files
    console.log('🔨 Generating proto definitions...');
    const protoFiles = this.generator.generateProtoFiles(
      parsedSchema.tables,
      parsedSchema.enums,
    );

    console.log(`  Generated ${protoFiles.size} proto file(s)`);

    // Step 3: Write proto files to disk
    console.log('💾 Writing proto files...');
    await this.writer.writeProtoFiles(protoFiles, this.config.outputPath);
  }
}

// Export all types and utilities
export * from './types.js';
export * from './parser/drizzle-parser.js';
export * from './generator/proto-generator.js';
export * from './generator/proto-writer.js';
export * from './generator/type-mapper.js';
