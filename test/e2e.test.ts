import { test, expect, describe, afterAll } from 'bun:test';
import { ProtoGenRunner } from '../src/index';
import { ProtoReader } from '../src/reader/proto-reader';
import * as fs from 'fs/promises';
import * as path from 'path';

const FIXTURES_DIR = path.join(import.meta.dir, 'fixtures');
const OUTPUT_DIR = path.join(import.meta.dir, 'output', 'e2e');

afterAll(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
});

describe('End-to-end', () => {
  test('generates proto files from basic schema', async () => {
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'basic'),
      outputPath: OUTPUT_DIR,
      protoPackageName: 'testapp',
    });

    await runner.run();

    // basic fixture uses appSchema so output is under testapp/app/v1
    const protoPath = path.join(OUTPUT_DIR, 'testapp', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');

    // Verify proto3 syntax
    expect(content).toContain('syntax = "proto3";');

    // Verify package
    expect(content).toContain('package testapp.app.v1;');

    // Verify messages exist
    expect(content).toContain('message User {');
    expect(content).toContain('message Post {');

    // Verify timestamp import
    expect(content).toContain('import "google/protobuf/timestamp.proto";');

    // Verify field types
    expect(content).toContain('string');
    expect(content).toContain('int32');
    expect(content).toContain('google.protobuf.Timestamp');
  });

  test('generates proto files from enum schema', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'enum-test');
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'enums'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
      options: {
        enumPrefix: 'PROTO',
        addUnspecified: true,
      },
    });

    await runner.run();

    const protoPath = path.join(outputDir, 'testapp', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');

    // Verify specific enum definitions from enums fixture
    expect(content).toContain('enum ProtoUserRole {');
    expect(content).toContain('PROTO_USER_ROLE_UNSPECIFIED = 0;');
    expect(content).toContain('PROTO_USER_ROLE_ADMIN = 1;');
    expect(content).toContain('PROTO_USER_ROLE_EDITOR = 2;');
    expect(content).toContain('PROTO_USER_ROLE_VIEWER = 3;');

    expect(content).toContain('enum ProtoStatus {');
    expect(content).toContain('PROTO_STATUS_UNSPECIFIED = 0;');
  });

  test('generates separate files for different schemas', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'multi-schema-test');
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'multi-schema'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
    });

    await runner.run();

    // Check auth schema file — fixture has accounts + sessions tables
    const authPath = path.join(outputDir, 'testapp', 'auth', 'v1', 'gen_types.proto');
    const authContent = await fs.readFile(authPath, 'utf-8');
    expect(authContent).toContain('package testapp.auth.v1;');
    expect(authContent).toContain('message Account {');
    expect(authContent).toContain('message Session {');

    // Check billing schema file — fixture has invoices table
    const billingPath = path.join(outputDir, 'testapp', 'billing', 'v1', 'gen_types.proto');
    const billingContent = await fs.readFile(billingPath, 'utf-8');
    expect(billingContent).toContain('package testapp.billing.v1;');
    expect(billingContent).toContain('message Invoice {');
  });

  test('run() returns GenerationResult with correct counts', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'result-test');
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'basic'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
    });

    const result = await runner.run();

    // basic fixture has exactly 2 tables (users, posts), 0 enums, 1 schema (app)
    expect(result.tableCount).toBe(2);
    expect(result.enumCount).toBe(0);
    expect(result.schemaCount).toBe(1);
    expect(result.fileCount).toBe(1);
    expect(result.writtenFiles).toHaveLength(1);
    expect(result.writtenFiles[0]).toContain('gen_types.proto');
  });

  test('auto-generated header contains correct tool name', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'header-test');
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'basic'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
    });

    await runner.run();

    const protoPath = path.join(outputDir, 'testapp', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');
    expect(content).toContain('drizzle-proto-generator');
    expect(content).toContain('WARNING: AUTO-GENERATED FILE');
  });
});

describe('End-to-end - field number stability', () => {
  test('preserves field numbers across regenerations', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'stability-test');
    const config = {
      inputPath: path.join(FIXTURES_DIR, 'basic'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
    };

    // First generation
    const runner1 = new ProtoGenRunner(config);
    await runner1.run();

    const protoPath = path.join(outputDir, 'testapp', 'app', 'v1', 'gen_types.proto');
    const firstContent = await fs.readFile(protoPath, 'utf-8');

    // Read field numbers from first generation
    const reader = new ProtoReader();
    const { fieldMap: firstFieldMap } = reader.parseProtoContent(firstContent);
    const userFieldsBefore = firstFieldMap.messages.get('User')!;

    // Second generation (same schema, should preserve numbers)
    const runner2 = new ProtoGenRunner(config);
    await runner2.run();

    const secondContent = await fs.readFile(protoPath, 'utf-8');
    const { fieldMap: secondFieldMap } = reader.parseProtoContent(secondContent);
    const userFieldsAfter = secondFieldMap.messages.get('User')!;

    // All field numbers should be identical
    for (const [name, number] of userFieldsBefore.entries()) {
      expect(userFieldsAfter.get(name)).toBe(number);
    }
  });

  test('fresh flag resets to sequential numbering', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'fresh-test');

    // First: generate with a manually crafted proto that has gaps
    const protoDir = path.join(outputDir, 'testapp', 'app', 'v1');
    await fs.mkdir(protoDir, { recursive: true });
    await fs.writeFile(
      path.join(protoDir, 'gen_types.proto'),
      [
        'syntax = "proto3";',
        'package testapp.app.v1;',
        '',
        'message User {',
        '  reserved 2;',
        '  reserved "removed";',
        '',
        '  string id = 1;',
        '  string name = 5;',
        '}',
      ].join('\n'),
    );

    // Generate with fresh: true — should ignore previous output
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'basic'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
      options: { fresh: true },
    });
    await runner.run();

    const protoPath = path.join(protoDir, 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');

    // Should NOT contain reserved directives
    expect(content).not.toContain('reserved');

    // Field numbers should be sequential starting from 1
    const reader = new ProtoReader();
    const { fieldMap } = reader.parseProtoContent(content);
    const userFields = fieldMap.messages.get('User')!;
    const numbers = Array.from(userFields.values()).sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers[1]).toBe(2);
  });
});
