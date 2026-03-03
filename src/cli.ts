#!/usr/bin/env node

/**
 * CLI for the Drizzle to Proto generator
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { ProtoGenRunner } from './index.js';
import type { GeneratorConfig } from './types.js';

const program = new Command();

program
  .name('proto')
  .description('Generate Protobuf definitions from Drizzle ORM schemas')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate proto files from Drizzle schemas')
  .option(
    '-i, --input <path>',
    'Path to Drizzle schema directory',
    'src/schema',
  )
  .option('-o, --output <path>', 'Output directory for proto files', 'proto')
  .option('-p, --package <name>', 'Base package name for proto files', 'proto')
  .option('--enum-prefix <prefix>', 'Prefix for enum values', 'PROTO')
  .option('--no-unspecified', 'Do not add UNSPECIFIED enum value')
  .option('--preserve-snake-case', 'Preserve snake_case in field names')
  .option('--no-comments', 'Do not generate comments')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      // Load config from file if provided
      let config: GeneratorConfig;

      if (options.config) {
        const configPath = path.resolve(options.config);
        if (!fs.existsSync(configPath)) {
          console.error(`Config file not found: ${configPath}`);
          process.exit(1);
        }

        const configModule = await import(configPath);
        config = configModule.default || configModule;
      } else {
        // Build config from CLI options
        config = {
          inputPath: path.resolve(options.input),
          outputPath: path.resolve(options.output),
          protoPackageName: options.package,
          packageResolvers: {},
          options: {
            useGoogleTimestamp: true,
            enumPrefix: options.enumPrefix,
            addUnspecified: options.unspecified !== false,
            preserveSnakeCase: options.preserveSnakeCase,
            generateComments: options.comments !== false,
          },
        };
      }

      // Validate input path
      if (!fs.existsSync(config.inputPath)) {
        console.error(`Input directory not found: ${config.inputPath}`);
        process.exit(1);
      }

      console.log('🚀 Starting proto generation...');
      console.log(`📂 Input: ${config.inputPath}`);
      console.log(`📂 Output: ${config.outputPath}`);
      console.log(`📦 Package: ${config.protoPackageName}`);
      console.log(`📦 Package Resolvers: `, config.packageResolvers);

      // Run the generator
      const runner = new ProtoGenRunner(config);
      await runner.run();

      console.log('✅ Proto generation completed successfully!');
    } catch (error) {
      console.error('❌ Proto generation failed:', error);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Create a configuration file template')
  .option(
    '-o, --output <path>',
    'Output path for config file',
    'proto.config.js',
  )
  .action(async (options) => {
    const configTemplate = `
/**
 * Proto Generator Configuration
 */

export default {
  // Path to your Drizzle schema files
  inputPath: './src/schema',
  
  // Output directory for generated proto files
  outputPath: './proto',
  
  // Base package name for proto files
  packageName: 'myapp',
  
  // Generation options
  options: {
    // Use google.protobuf.Timestamp for date/time fields
    useGoogleTimestamp: true,
    
    // Use google.protobuf wrappers for nullable primitive types
    useGoogleWrappers: false,
    
    // Prefix for enum values
    enumPrefix: 'PROTO',
    
    // Add UNSPECIFIED as the first enum value
    addUnspecified: true,
    
    // Preserve snake_case in field names (default: convert to camelCase)
    preserveSnakeCase: false,
    
    // Generate comments in proto files
    generateComments: true,
  },
};
`.trim();

    const outputPath = path.resolve(options.output);

    if (fs.existsSync(outputPath)) {
      console.error(`File already exists: ${outputPath}`);
      process.exit(1);
    }

    fs.writeFileSync(outputPath, configTemplate, 'utf-8');
    console.log(`✅ Created configuration file: ${outputPath}`);
  });

program.parse();
