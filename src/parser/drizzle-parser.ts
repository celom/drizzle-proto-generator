/**
 * Parser for Drizzle ORM schema files using ts-morph
 */

import {
  Project,
  SourceFile,
  CallExpression,
  Node,
  VariableDeclaration,
  ObjectLiteralExpression,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from 'ts-morph';
import type { CompilerOptions } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import type {
  DrizzleTable,
  DrizzleColumn,
  DrizzleEnum,
  ParsedSchema,
  PackageResolvers,
} from '../types.js';

// ============================================================================
// Configuration Constants
// ============================================================================

const COMPILER_OPTIONS = {
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Node10,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
};

const FILE_EXTENSIONS = ['', '.ts', '.js', '/index.ts', '/index.js'];

const IGNORED_PATTERNS = ['**/*.test.ts', '**/*.spec.ts'];

const COLUMN_MODIFIERS = {
  NOT_NULL: 'notNull',
  PRIMARY_KEY: 'primaryKey',
  UNIQUE: 'unique',
  ARRAY: 'array',
} as const;

const SPECIAL_FUNCTIONS = {
  CREATE_ID: 'createIdColumn',
  CREATE_TIMESTAMP: 'createTimestampColumn',
} as const;

const SPECIAL_FUNCTION_TYPES = {
  [SPECIAL_FUNCTIONS.CREATE_ID]: 'varchar',
  [SPECIAL_FUNCTIONS.CREATE_TIMESTAMP]: 'timestamp',
} as const;

const DRIZZLE_DECLARATIONS = {
  TABLE: '.table',
  PG_ENUM: 'pgEnum',
  PG_SCHEMA: 'pgSchema',
} as const;

const DEFAULT_PACKAGE_RESOLVERS: PackageResolvers = {};

// ============================================================================
// Pure Utility Functions
// ============================================================================

/**
 * Extract string value from a string literal node
 */
const extractStringValue = (node: Node): string | null =>
  Node.isStringLiteral(node) ? node.getLiteralValue() : null;

/**
 * Extract numeric value from a numeric literal node
 */
const extractNumericValue = (node: Node): number | null =>
  Node.isNumericLiteral(node) ? node.getLiteralValue() : null;

/**
 * Extract array values from an array literal or identifier
 */
const extractArrayStringValues = (node: Node): string[] => {
  if (!Node.isArrayLiteralExpression(node)) return [];

  return node
    .getElements()
    .map(extractStringValue)
    .filter((value): value is string => value !== null);
};

/**
 * Get call expression from variable declaration initializer
 */
const getCallExpression = (
  node: VariableDeclaration,
): CallExpression | null => {
  const initializer = node.getInitializer();
  return initializer && Node.isCallExpression(initializer) ? initializer : null;
};

/**
 * Extract string argument from call expression at given index
 */
const getStringArgument = (
  call: CallExpression,
  index: number,
): string | null => {
  const args = call.getArguments();
  const arg = args[index];
  return args.length > index && arg ? extractStringValue(arg) : null;
};

/**
 * Try different file extensions to resolve a path
 */
const tryResolveWithExtensions = (basePath: string): string | null => {
  for (const ext of FILE_EXTENSIONS) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return null;
};

/**
 * Find the workspace root by looking for monorepo markers
 */
const findWorkspaceRoot = (startPath: string): string | null => {
  const monorepoMarkers = [
    'pnpm-workspace.yaml',
    'pnpm-workspace.yml',
    'nx.json',
    'bun.lock',
    'lerna.json',
    'rush.json',
    '.yarnrc.yml', // Yarn 2+ workspaces
    'turbo.json',
  ];

  let currentPath = startPath;
  let lastPackageJsonPath: string | null = null;

  while (currentPath !== path.dirname(currentPath)) {
    // Check for monorepo markers first
    for (const marker of monorepoMarkers) {
      if (fs.existsSync(path.join(currentPath, marker))) {
        return currentPath;
      }
    }

    // Check for package.json with workspace configuration
    const packageJsonPath = path.join(currentPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf-8'),
        );
        // Check if this package.json defines workspaces (npm/yarn/pnpm)
        if (packageJson.workspaces) {
          return currentPath;
        }
        lastPackageJsonPath = currentPath;
      } catch {
        // Ignore parse errors
      }
    }

    currentPath = path.dirname(currentPath);
  }

  // If no monorepo markers found, return the directory with the outermost package.json
  return lastPackageJsonPath;
};

/**
 * Create a file path resolver with package resolution config
 */
const createFilePathResolver = (packageResolvers: PackageResolvers = {}) => {
  return (moduleSpecifier: string, currentFile: SourceFile): string | null => {
    const specifier = moduleSpecifier.endsWith('.js')
      ? moduleSpecifier.replace(/\.js$/, '.ts')
      : moduleSpecifier;

    // Handle relative imports
    if (specifier.startsWith('.')) {
      const currentDir = path.dirname(currentFile.getFilePath());
      const resolved = path.resolve(currentDir, specifier);
      return tryResolveWithExtensions(resolved);
    }

    // Check package resolvers for custom package mappings
    for (const [packagePrefix, relativePath] of Object.entries(
      packageResolvers,
    )) {
      if (specifier.startsWith(packagePrefix)) {
        // Find workspace/project root
        const projectRoot = findWorkspaceRoot(
          path.dirname(currentFile.getFilePath()),
        );

        if (projectRoot) {
          const resolvedPath = path.join(projectRoot, relativePath);
          return fs.existsSync(resolvedPath) ? resolvedPath : null;
        }
      }
    }

    return null;
  };
};

/**
 * Find the base call expression in a method chain
 */
const findBaseCall = (node: Node): CallExpression | null => {
  if (!Node.isCallExpression(node)) return null;

  const expression = node.getExpression();
  if (Node.isIdentifier(expression)) return node;
  if (Node.isPropertyAccessExpression(expression)) {
    return findBaseCall(expression.getExpression());
  }

  return null;
};

/**
 * Extract length from options object
 */
const extractLengthFromOptions = (
  options: ObjectLiteralExpression,
): number | null => {
  const lengthProp = options.getProperty('length');
  if (!lengthProp || !Node.isPropertyAssignment(lengthProp)) return null;

  const initializer = lengthProp.getInitializer();
  return initializer ? extractNumericValue(initializer) : null;
};

/**
 * Extract column type from the base function name
 */
const extractColumnType = (callExpr: CallExpression): string => {
  const expression = callExpr.getExpression();
  if (!Node.isIdentifier(expression)) return 'unknown';

  const typeName = expression.getText();

  // Handle special column creation functions
  if (typeName in SPECIAL_FUNCTION_TYPES) {
    return SPECIAL_FUNCTION_TYPES[
      typeName as keyof typeof SPECIAL_FUNCTION_TYPES
    ];
  }

  // Check for length parameter in varchar/text types
  const shouldCheckLength = typeName === 'varchar' || typeName === 'text';
  if (shouldCheckLength) {
    const args = callExpr.getArguments();
    if (args.length > 1 && Node.isObjectLiteralExpression(args[1])) {
      const lengthValue = extractLengthFromOptions(args[1]);
      if (lengthValue) return `${typeName}(${lengthValue})`;
    }
  }

  return typeName;
};

/**
 * Extract column modifiers from a method chain
 */
const extractColumnModifiers = (node: Node) => {
  const modifiers = {
    isNullable: true,
    isPrimaryKey: false,
    isUnique: false,
    isArray: false,
  };

  let current = node;
  while (Node.isCallExpression(current)) {
    const expression = current.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) break;

    const methodName = expression.getName();
    switch (methodName) {
      case COLUMN_MODIFIERS.NOT_NULL:
        modifiers.isNullable = false;
        break;
      case COLUMN_MODIFIERS.PRIMARY_KEY:
        modifiers.isPrimaryKey = true;
        modifiers.isNullable = false;
        break;
      case COLUMN_MODIFIERS.UNIQUE:
        modifiers.isUnique = true;
        break;
      case COLUMN_MODIFIERS.ARRAY:
        modifiers.isArray = true;
        break;
    }

    current = expression.getExpression();
  }

  return modifiers;
};

// ============================================================================
// Parser Context
// ============================================================================

interface ParserConfig {
  compilerOptions?: CompilerOptions;
  filePatterns?: string[];
  ignoredPatterns?: string[];
  /**
   * Maps package names to their relative paths from the project root
   * Example: { '@myorg/core': 'packages/core/src/index.ts' }
   */
  packageResolvers?: PackageResolvers;
}

class ImportResolver {
  private cache = new Map<string, string[]>();
  private project: Project;
  private resolveFilePath: (
    moduleSpecifier: string,
    currentFile: SourceFile,
  ) => string | null;

  constructor(project: Project, packageResolvers: PackageResolvers = {}) {
    this.project = project;
    this.resolveFilePath = createFilePathResolver(packageResolvers);
  }

  resolve(
    constantName: string,
    moduleSpecifier: string,
    currentFile: SourceFile,
  ): string[] {
    const cacheKey = `${moduleSpecifier}:${constantName}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const resolvedPath = this.resolveFilePath(moduleSpecifier, currentFile);
    if (!resolvedPath) return [];

    const values = this.findConstantValues(constantName, resolvedPath);
    this.cache.set(cacheKey, values);

    return values;
  }

  private findConstantValues(constantName: string, filePath: string): string[] {
    const sourceFile = this.project.addSourceFileAtPath(filePath);

    // Try direct declaration
    const constantDecl = sourceFile.getVariableDeclaration(constantName);
    if (constantDecl) {
      const values = this.extractConstantArrayValues(constantDecl);
      if (values.length > 0) return values;
    }

    // Check wildcard re-exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      if (exportDecl.getNamedExports().length > 0) continue;

      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;

      const reexportPath = this.resolveFilePath(moduleSpecifier, sourceFile);
      if (reexportPath) {
        const values = this.findConstantValues(constantName, reexportPath);
        if (values.length > 0) return values;
      }
    }

    return [];
  }

  private extractConstantArrayValues(decl: VariableDeclaration): string[] {
    const initializer = decl.getInitializer();
    if (!initializer) return [];

    const arrayExpr = Node.isAsExpression(initializer)
      ? initializer.getExpression()
      : initializer;

    return extractArrayStringValues(arrayExpr);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Main Parser Class
// ============================================================================

export class DrizzleSchemaParser {
  private project: Project;
  private importResolver: ImportResolver;
  private config: Required<ParserConfig>;
  private knownEnumNames: Set<string> = new Set();

  constructor(config: ParserConfig = {}) {
    this.config = {
      compilerOptions: config.compilerOptions || COMPILER_OPTIONS,
      filePatterns: config.filePatterns || ['**/*.ts'],
      ignoredPatterns: config.ignoredPatterns || IGNORED_PATTERNS,
      packageResolvers: config.packageResolvers || DEFAULT_PACKAGE_RESOLVERS,
    };

    this.project = new Project({
      compilerOptions: this.config.compilerOptions,
    });

    this.importResolver = new ImportResolver(
      this.project,
      this.config.packageResolvers,
    );
  }

  /**
   * Parse all schema files in a directory
   */
  async parseSchemas(inputPath: string): Promise<ParsedSchema> {
    const patterns = this.config.filePatterns.map((pattern) =>
      path.join(inputPath, pattern),
    );

    const schemaFiles = await glob(patterns, {
      ignore: this.config.ignoredPatterns,
    });

    const result: ParsedSchema = {
      tables: [],
      enums: [],
      schemas: [],
    };

    for (const filePath of schemaFiles) {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const fileResult = this.parseSchemaFile(sourceFile);

      result.tables.push(...fileResult.tables);
      result.enums.push(...fileResult.enums);
      result.schemas.push(...fileResult.schemas);
    }

    // Clear import cache after parsing all files
    this.importResolver.clearCache();

    return result;
  }

  /**
   * Parse a single schema file
   */
  private parseSchemaFile(sourceFile: SourceFile): ParsedSchema {
    const result: ParsedSchema = {
      tables: [],
      enums: [],
      schemas: [],
    };

    const importedConstants = this.collectImports(sourceFile);

    // First pass: collect enum variable names so column parsing can
    // identify enum references regardless of naming convention
    sourceFile.forEachDescendant((node) => {
      if (!Node.isVariableDeclaration(node)) return;
      const callExpr = getCallExpression(node);
      if (!callExpr) return;
      if (callExpr.getExpression().getText() === DRIZZLE_DECLARATIONS.PG_ENUM) {
        this.knownEnumNames.add(node.getName());
      }
    });

    // Second pass: parse all declarations
    sourceFile.forEachDescendant((node) => {
      if (!Node.isVariableDeclaration(node)) return;

      const parsed = this.parseDeclaration(node, importedConstants);
      if (!parsed) return;

      switch (parsed.type) {
        case 'enum':
          result.enums.push(parsed.data as DrizzleEnum);
          break;
        case 'table':
          result.tables.push(parsed.data as DrizzleTable);
          break;
        case 'schema':
          result.schemas.push(parsed.data as string);
          break;
      }
    });

    return result;
  }

  /**
   * Parse a variable declaration into its appropriate type
   */
  private parseDeclaration(
    node: VariableDeclaration,
    importedConstants: Map<string, string[]>,
  ): { type: 'enum' | 'table' | 'schema'; data: unknown } | null {
    const callExpr = getCallExpression(node);
    if (!callExpr) return null;

    const expressionText = callExpr.getExpression().getText();

    if (expressionText === DRIZZLE_DECLARATIONS.PG_ENUM) {
      const data = this.parsePgEnum(node, callExpr, importedConstants);
      return data ? { type: 'enum', data } : null;
    }

    if (expressionText === DRIZZLE_DECLARATIONS.PG_SCHEMA) {
      const data = getStringArgument(callExpr, 0);
      return data ? { type: 'schema', data } : null;
    }

    if (expressionText.includes(DRIZZLE_DECLARATIONS.TABLE)) {
      const data = this.parseTable(node, callExpr);
      return data ? { type: 'table', data } : null;
    }

    return null;
  }

  /**
   * Collect imported constants for enum value resolution
   */
  private collectImports(sourceFile: SourceFile): Map<string, string[]> {
    const constants = new Map<string, string[]>();

    sourceFile.getImportDeclarations().forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();

      importDecl.getNamedImports().forEach((namedImport) => {
        const name = namedImport.getName();
        const values = this.importResolver.resolve(
          name,
          moduleSpecifier,
          sourceFile,
        );
        if (values.length > 0) {
          constants.set(name, values);
        }
      });
    });

    return constants;
  }

  /**
   * Parse a pgEnum declaration
   */
  private parsePgEnum(
    node: VariableDeclaration,
    callExpr: CallExpression,
    importedConstants: Map<string, string[]>,
  ): DrizzleEnum | null {
    const name = node.getName();
    const enumDbName = getStringArgument(callExpr, 0);

    if (!enumDbName) return null;

    const args = callExpr.getArguments();
    if (args.length < 2) return null;

    const valuesArg = args[1];
    if (!valuesArg) return null;
    const values = this.extractEnumValues(valuesArg, importedConstants);

    return values.length > 0 ? { name, values } : null;
  }

  /**
   * Extract enum values from argument (array or identifier)
   */
  private extractEnumValues(
    node: Node,
    importedConstants: Map<string, string[]>,
  ): string[] {
    // Try direct array extraction
    const directValues = extractArrayStringValues(node);
    if (directValues.length > 0) return directValues;

    // Try imported constant
    if (Node.isIdentifier(node)) {
      return importedConstants.get(node.getText()) || [];
    }

    return [];
  }

  /**
   * Parse a table definition
   */
  private parseTable(
    node: VariableDeclaration,
    callExpr: CallExpression,
  ): DrizzleTable | null {
    const tableName = node.getName();
    const tableDbName = getStringArgument(callExpr, 0);

    if (!tableDbName) return null;

    const args = callExpr.getArguments();
    if (args.length < 2 || !Node.isObjectLiteralExpression(args[1])) {
      return null;
    }

    const columns = this.parseColumns(args[1]);
    if (columns.length === 0) return null;

    const schemaName = this.extractSchemaName(callExpr);

    return { name: tableName, schema: schemaName, columns };
  }

  /**
   * Extract schema name from table call expression
   */
  private extractSchemaName(callExpr: CallExpression): string | undefined {
    const expression = callExpr.getExpression();

    if (!Node.isPropertyAccessExpression(expression)) return undefined;

    const object = expression.getExpression();
    if (!Node.isIdentifier(object)) return undefined;

    const name = object.getText();
    return name.endsWith('Schema') ? name.slice(0, -6) : name;
  }

  /**
   * Parse columns from an object literal
   */
  private parseColumns(columnsNode: ObjectLiteralExpression): DrizzleColumn[] {
    return columnsNode
      .getProperties()
      .filter(Node.isPropertyAssignment)
      .map((prop) => {
        const initializer = prop.getInitializer();
        return initializer
          ? this.parseColumn(prop.getName(), initializer)
          : null;
      })
      .filter((col): col is DrizzleColumn => col !== null);
  }

  /**
   * Parse a single column definition
   */
  private parseColumn(name: string, node: Node): DrizzleColumn | null {
    const baseCall = findBaseCall(node);
    if (!baseCall) return null;

    const expression = baseCall.getExpression();
    if (!Node.isIdentifier(expression)) return null;

    const identifierName = expression.getText();

    // Determine type and database column name
    const isEnum = this.knownEnumNames.has(identifierName) || identifierName.includes('Enum');
    const type = isEnum ? identifierName : extractColumnType(baseCall);
    const dbColumnName = getStringArgument(baseCall, 0) || name;

    // Extract modifiers
    const modifiers = extractColumnModifiers(node);

    return {
      name: dbColumnName,
      type,
      ...modifiers,
      length: undefined, // Already encoded in type string
    };
  }
}
