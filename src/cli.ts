#!/usr/bin/env node

/**
 * CLI for the Drizzle to Proto generator
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { ProtoGenRunner } from './index.js';
import type { GeneratorConfig } from './types.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

/**
 * Build a partial config from CLI flags that were explicitly set (not defaults).
 * Used to merge CLI overrides on top of a config file.
 */
function buildCliOverrides(options: Record<string, unknown>): Partial<GeneratorConfig> {
  const overrides: Partial<GeneratorConfig> = {};
  const optionOverrides: Partial<NonNullable<GeneratorConfig['options']>> = {};

  if (options.input !== 'src/schema') overrides.inputPath = path.resolve(options.input as string);
  if (options.output !== 'proto') overrides.outputPath = path.resolve(options.output as string);
  if (options.package !== 'proto') overrides.protoPackageName = options.package as string;

  if (options.fresh) optionOverrides.fresh = true;
  if (options.camelCase) optionOverrides.useCamelCase = true;
  if (options.googleDate) optionOverrides.useGoogleDate = true;
  if (options.googleStruct) optionOverrides.useGoogleStruct = true;
  if (options.googleTimestamp === false) optionOverrides.useGoogleTimestamp = false;
  if (options.unspecified === false) optionOverrides.addUnspecified = false;
  if (options.comments === false) optionOverrides.generateComments = false;
  if (options.enumPrefix !== undefined) optionOverrides.enumPrefix = options.enumPrefix as string;

  if (Object.keys(optionOverrides).length > 0) {
    overrides.options = optionOverrides;
  }

  return overrides;
}

const program = new Command();

program
  .name('proto')
  .description('Generate Protobuf definitions from Drizzle ORM schemas')
  .version(version);

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
  .option('--enum-prefix <prefix>', 'Prefix for enum values')
  .option('--no-unspecified', 'Do not add UNSPECIFIED enum value')
  .option('--no-google-timestamp', 'Use string instead of google.protobuf.Timestamp for date/time fields')
  .option('--google-date', 'Use google.type.Date for date fields')
  .option('--google-struct', 'Use google.protobuf.Struct for json/jsonb fields')
  .option('--camel-case', 'Use camelCase for field names instead of snake_case')
  .option('--no-comments', 'Do not generate comments')
  .option('--fresh', 'Ignore previously generated proto files and assign field numbers sequentially')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      // Load config from file if provided, or auto-detect in current directory
      let config: GeneratorConfig;

      const configPath = options.config
        ? path.resolve(options.config)
        : fs.existsSync(path.resolve('proto.config.js'))
          ? path.resolve('proto.config.js')
          : null;

      // Build config entirely from CLI flags
      const cliConfig: GeneratorConfig = {
        inputPath: path.resolve(options.input),
        outputPath: path.resolve(options.output),
        protoPackageName: options.package,
        packageResolvers: {},
        options: {
          useGoogleTimestamp: options.googleTimestamp !== false,
          useGoogleDate: options.googleDate || false,
          useGoogleStruct: options.googleStruct || false,
          ...(options.enumPrefix !== undefined && { enumPrefix: options.enumPrefix }),
          addUnspecified: options.unspecified !== false,
          useCamelCase: options.camelCase || false,
          generateComments: options.comments !== false,
          fresh: options.fresh || false,
        },
      };

      if (configPath) {
        if (!fs.existsSync(configPath)) {
          console.error(`Config file not found: ${configPath}`);
          process.exit(1);
        }

        console.log(`Using config file: ${configPath}`);
        const configModule = await import(configPath);
        const fileConfig: GeneratorConfig = configModule.default || configModule;

        // Merge: CLI flags that differ from defaults override file config
        const cliOverrides = buildCliOverrides(options);
        config = {
          ...fileConfig,
          ...cliOverrides,
          options: { ...fileConfig.options, ...cliOverrides.options },
        };
      } else {
        config = cliConfig;
      }

      // Validate input path
      if (!fs.existsSync(config.inputPath)) {
        console.error(`Input directory not found: ${config.inputPath}`);
        process.exit(1);
      }

      console.log('Starting proto generation...');
      console.log(`  Input: ${config.inputPath}`);
      console.log(`  Output: ${config.outputPath}`);
      console.log(`  Package: ${config.protoPackageName}`);

      // Run the generator
      const runner = new ProtoGenRunner(config);
      const result = await runner.run();

      console.log(`  Found ${result.tableCount} tables, ${result.enumCount} enums, ${result.declaredSchemaCount} schemas`);
      console.log(`  Generated ${result.fileCount} proto file(s):`);
      for (const file of result.writtenFiles) {
        console.log(`    ${file}`);
      }

      console.log('Proto generation completed successfully!');
    } catch (error) {
      console.error('Proto generation failed:', error);
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
 * @type {import('drizzle-proto-generator').GeneratorConfig}
 */

export default {
  // Path to your Drizzle schema files
  inputPath: './src/schema',

  // Output directory for generated proto files
  outputPath: './proto',

  // Base package name for proto files
  protoPackageName: 'myapp',

  // Generation options
  options: {
    // Use google.protobuf.Timestamp for timestamp/time fields
    useGoogleTimestamp: true,

    // Use google.type.Date for date fields
    useGoogleDate: false,

    // Use google.protobuf.Struct for json/jsonb fields
    useGoogleStruct: false,

    // Prefix for enum values (omit for proto style guide default: enum name as prefix)
    // enumPrefix: '',

    // Add UNSPECIFIED as the first enum value
    addUnspecified: true,

    // Use camelCase for field names (default: snake_case per proto style guide)
    useCamelCase: false,

    // Generate comments in proto files
    generateComments: true,

    // Skip reading previous proto files, assign field numbers sequentially
    // fresh: false,
  },
};
`.trim();

    const outputPath = path.resolve(options.output);

    if (fs.existsSync(outputPath)) {
      console.error(`File already exists: ${outputPath}`);
      process.exit(1);
    }

    fs.writeFileSync(outputPath, configTemplate, 'utf-8');
    console.log(`Created configuration file: ${outputPath}`);
  });

program.parse();
