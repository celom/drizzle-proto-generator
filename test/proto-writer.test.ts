import { test, expect, describe, afterAll } from 'bun:test';
import { ProtoWriter } from '../src/generator/proto-writer';
import type { ProtoFile } from '../src/types';
import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUT_DIR = path.join(import.meta.dir, 'output', 'proto-writer');

afterAll(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
});

function makeProtoFile(overrides: Partial<ProtoFile> = {}): ProtoFile {
  return {
    syntax: 'proto3',
    package: 'myapp.user.v1',
    imports: [],
    enums: [],
    messages: [],
    ...overrides,
  };
}

async function writeAndRead(
  testName: string,
  files: Map<string, ProtoFile>,
  readPackage = 'myapp.user.v1',
): Promise<string> {
  const outputDir = path.join(OUTPUT_DIR, testName);
  const writer = new ProtoWriter();
  await writer.writeProtoFiles(files, outputDir);

  const packageDir = readPackage.replace(/\./g, '/');
  const filePath = path.join(outputDir, packageDir, 'gen_types.proto');
  return fs.readFile(filePath, 'utf-8');
}

describe('ProtoWriter', () => {
  test('writes proto file to correct path structure', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'path-structure');
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('user', makeProtoFile({
      package: 'myapp.user.v1',
      messages: [{
        name: 'User',
        fields: [{ name: 'id', type: 'string', number: 1, optional: false, repeated: false }],
      }],
    }));

    await writer.writeProtoFiles(files, outputDir);

    const filePath = path.join(outputDir, 'myapp', 'user', 'v1', 'gen_types.proto');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('generated content starts with auto-generated warning', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile());

    const content = await writeAndRead('warning-header', files);
    expect(content).toContain('WARNING: AUTO-GENERATED FILE');
    expect(content).toContain('drizzle-proto-generator');
  });

  test('generated content has correct syntax and package', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({ package: 'myapp.billing.v1' }));

    const content = await writeAndRead('syntax-package', files, 'myapp.billing.v1');
    expect(content).toContain('syntax = "proto3";');
    expect(content).toContain('package myapp.billing.v1;');
  });

  test('generated content includes imports', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      imports: ['google/protobuf/timestamp.proto'],
    }));

    const content = await writeAndRead('imports', files);
    expect(content).toContain('import "google/protobuf/timestamp.proto";');
  });

  test('generated content includes enum definitions', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      enums: [{
        name: 'UserRole',
        values: [
          { name: 'USER_ROLE_UNSPECIFIED', number: 0 },
          { name: 'USER_ROLE_ADMIN', number: 1 },
          { name: 'USER_ROLE_VIEWER', number: 2 },
        ],
      }],
    }));

    const content = await writeAndRead('enums', files);
    expect(content).toContain('enum UserRole {');
    expect(content).toContain('USER_ROLE_UNSPECIFIED = 0;');
    expect(content).toContain('USER_ROLE_ADMIN = 1;');
    expect(content).toContain('USER_ROLE_VIEWER = 2;');
  });

  test('generated content includes message definitions', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      messages: [{
        name: 'User',
        fields: [
          { name: 'id', type: 'string', number: 1, optional: false, repeated: false },
          { name: 'name', type: 'string', number: 2, optional: false, repeated: false },
          { name: 'bio', type: 'string', number: 3, optional: true, repeated: false },
          { name: 'tags', type: 'string', number: 4, optional: false, repeated: true },
        ],
      }],
    }));

    const content = await writeAndRead('messages', files);
    expect(content).toContain('message User {');
    expect(content).toContain('string id = 1;');
    expect(content).toContain('string name = 2;');
    expect(content).toContain('optional string bio = 3;');
    expect(content).toContain('repeated string tags = 4;');
  });

  test('generated content includes field comments', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      messages: [{
        name: 'User',
        fields: [
          { name: 'id', type: 'string', number: 1, optional: false, repeated: false, comment: 'Primary key' },
        ],
      }],
    }));

    const content = await writeAndRead('comments', files);
    expect(content).toContain('// Primary key');
  });

  test('renders reserved numbers in messages', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      messages: [{
        name: 'User',
        fields: [
          { name: 'id', type: 'string', number: 1, optional: false, repeated: false },
        ],
        reservedNumbers: [3, 5],
        reservedNames: ['bio', 'avatar'],
      }],
    }));

    const content = await writeAndRead('reserved-message', files);
    expect(content).toContain('reserved 3, 5;');
    expect(content).toContain('reserved "bio", "avatar";');
  });

  test('renders reserved numbers in enums', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      enums: [{
        name: 'Status',
        values: [
          { name: 'STATUS_UNSPECIFIED', number: 0 },
          { name: 'STATUS_ACTIVE', number: 1 },
        ],
        reservedNumbers: [3],
        reservedNames: ['STATUS_DELETED'],
      }],
    }));

    const content = await writeAndRead('reserved-enum', files);
    expect(content).toContain('reserved 3;');
    expect(content).toContain('reserved "STATUS_DELETED";');
  });

  test('omits reserved directives when not present', async () => {
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      messages: [{
        name: 'User',
        fields: [
          { name: 'id', type: 'string', number: 1, optional: false, repeated: false },
        ],
      }],
    }));

    const content = await writeAndRead('no-reserved', files);
    expect(content).not.toContain('reserved');
  });
});
