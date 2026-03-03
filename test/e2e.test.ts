import { test, expect, describe, afterAll } from 'bun:test';
import { ProtoGenRunner } from '../src/index';
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

    // Verify enum definitions
    expect(content).toContain('enum');
    expect(content).toContain('UNSPECIFIED');
  });

  test('generates separate files for different schemas', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'multi-schema-test');
    const runner = new ProtoGenRunner({
      inputPath: path.join(FIXTURES_DIR, 'multi-schema'),
      outputPath: outputDir,
      protoPackageName: 'testapp',
    });

    await runner.run();

    // Check auth schema file
    const authPath = path.join(outputDir, 'testapp', 'auth', 'v1', 'gen_types.proto');
    const authContent = await fs.readFile(authPath, 'utf-8');
    expect(authContent).toContain('package testapp.auth.v1;');
    expect(authContent).toContain('message Account {');

    // Check billing schema file
    const billingPath = path.join(outputDir, 'testapp', 'billing', 'v1', 'gen_types.proto');
    const billingContent = await fs.readFile(billingPath, 'utf-8');
    expect(billingContent).toContain('package testapp.billing.v1;');
    expect(billingContent).toContain('message Invoice {');
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
    expect(content).not.toContain('@bueller');
  });
});
