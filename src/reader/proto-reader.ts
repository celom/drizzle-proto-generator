/**
 * Read previously generated .proto files to extract field number assignments
 * for preserving wire compatibility across regenerations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import type { ExistingFieldMap, FieldNumberRegistry } from '../types.js';

type ParserState = 'top-level' | 'in-message' | 'in-enum';

function createEmptyFieldMap(): ExistingFieldMap {
  return {
    messages: new Map(),
    enums: new Map(),
    messageReservedNumbers: new Map(),
    messageReservedNames: new Map(),
    enumReservedNumbers: new Map(),
    enumReservedNames: new Map(),
  };
}

export class ProtoReader {
  /**
   * Read all previously generated proto files from the output directory.
   * Returns a registry keyed by package name.
   */
  async readExistingProtos(outputPath: string): Promise<FieldNumberRegistry> {
    const registry: FieldNumberRegistry = new Map();

    let protoFiles: string[];
    try {
      protoFiles = await glob(
        path.join(outputPath, '**/gen_types.proto').replace(/\\/g, '/'),
      );
    } catch {
      return registry;
    }

    for (const filePath of protoFiles) {
      const content = await fs.readFile(filePath, 'utf-8');
      const { packageName, fieldMap } = this.parseProtoContent(content);
      if (packageName) {
        registry.set(packageName, fieldMap);
      }
    }

    return registry;
  }

  /**
   * Parse a single proto file's content and extract field/enum number assignments.
   */
  parseProtoContent(content: string): {
    packageName: string | null;
    fieldMap: ExistingFieldMap;
  } {
    const fieldMap = createEmptyFieldMap();
    let packageName: string | null = null;
    let state: ParserState = 'top-level';
    let currentName = '';

    const lines = content.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//')) continue;

      // Package declaration
      const packageMatch = line.match(/^package\s+(\S+);$/);
      if (packageMatch) {
        packageName = packageMatch[1]!;
        continue;
      }

      // Message opening
      const messageMatch = line.match(/^message\s+(\w+)\s*\{$/);
      if (messageMatch && state === 'top-level') {
        state = 'in-message';
        currentName = messageMatch[1]!;
        fieldMap.messages.set(currentName, new Map());
        continue;
      }

      // Enum opening
      const enumMatch = line.match(/^enum\s+(\w+)\s*\{$/);
      if (enumMatch && state === 'top-level') {
        state = 'in-enum';
        currentName = enumMatch[1]!;
        fieldMap.enums.set(currentName, new Map());
        continue;
      }

      // Closing brace
      if (line === '}') {
        state = 'top-level';
        currentName = '';
        continue;
      }

      // Inside a message
      if (state === 'in-message') {
        // Reserved numbers: reserved 3, 5, 8;
        const reservedNumMatch = line.match(/^reserved\s+([\d,\s]+);$/);
        if (reservedNumMatch) {
          const nums = reservedNumMatch[1]!
            .split(',')
            .map((s) => parseInt(s.trim(), 10));
          const existing =
            fieldMap.messageReservedNumbers.get(currentName) || [];
          fieldMap.messageReservedNumbers.set(
            currentName,
            existing.concat(nums),
          );
          continue;
        }

        // Reserved names: reserved "foo", "bar";
        const reservedNameMatch = line.match(/^reserved\s+(".*");$/);
        if (reservedNameMatch) {
          const names = reservedNameMatch[1]!
            .split(',')
            .map((s) => s.trim().replace(/^"|"$/g, ''));
          const existing =
            fieldMap.messageReservedNames.get(currentName) || [];
          fieldMap.messageReservedNames.set(
            currentName,
            existing.concat(names),
          );
          continue;
        }

        // Field: optional string id = 1; or repeated int32 tags = 5;
        const fieldMatch = line.match(
          /^(?:optional\s+|repeated\s+)?[\w.]+\s+(\w+)\s*=\s*(\d+);$/,
        );
        if (fieldMatch) {
          const fieldName = fieldMatch[1]!;
          const fieldNumber = parseInt(fieldMatch[2]!, 10);
          fieldMap.messages.get(currentName)!.set(fieldName, fieldNumber);
          continue;
        }
      }

      // Inside an enum
      if (state === 'in-enum') {
        // Reserved numbers
        const reservedNumMatch = line.match(/^reserved\s+([\d,\s]+);$/);
        if (reservedNumMatch) {
          const nums = reservedNumMatch[1]!
            .split(',')
            .map((s) => parseInt(s.trim(), 10));
          const existing =
            fieldMap.enumReservedNumbers.get(currentName) || [];
          fieldMap.enumReservedNumbers.set(
            currentName,
            existing.concat(nums),
          );
          continue;
        }

        // Reserved names
        const reservedNameMatch = line.match(/^reserved\s+(".*");$/);
        if (reservedNameMatch) {
          const names = reservedNameMatch[1]!
            .split(',')
            .map((s) => s.trim().replace(/^"|"$/g, ''));
          const existing =
            fieldMap.enumReservedNames.get(currentName) || [];
          fieldMap.enumReservedNames.set(
            currentName,
            existing.concat(names),
          );
          continue;
        }

        // Enum value: USER_ROLE_ADMIN = 1;
        const valueMatch = line.match(/^(\w+)\s*=\s*(\d+);$/);
        if (valueMatch) {
          const valueName = valueMatch[1]!;
          const valueNumber = parseInt(valueMatch[2]!, 10);
          fieldMap.enums.get(currentName)!.set(valueName, valueNumber);
          continue;
        }
      }
    }

    return { packageName, fieldMap };
  }
}
