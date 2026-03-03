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

describe('ProtoWriter', () => {
  test('writes proto file to correct path structure', async () => {
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('user', makeProtoFile({
      package: 'myapp.user.v1',
      messages: [{
        name: 'User',
        fields: [{ name: 'id', type: 'string', number: 1, optional: false, repeated: false }],
      }],
    }));

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('generated content starts with auto-generated warning', async () => {
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile());

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('WARNING: AUTO-GENERATED FILE');
    expect(content).toContain('drizzle-proto-generator');
  });

  test('generated content has correct syntax and package', async () => {
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({ package: 'myapp.billing.v1' }));

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'billing', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('syntax = "proto3";');
    expect(content).toContain('package myapp.billing.v1;');
  });

  test('generated content includes imports', async () => {
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      imports: ['google/protobuf/timestamp.proto'],
    }));

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('import "google/protobuf/timestamp.proto";');
  });

  test('generated content includes enum definitions', async () => {
    const writer = new ProtoWriter();
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

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('enum UserRole {');
    expect(content).toContain('USER_ROLE_UNSPECIFIED = 0;');
    expect(content).toContain('USER_ROLE_ADMIN = 1;');
    expect(content).toContain('USER_ROLE_VIEWER = 2;');
  });

  test('generated content includes message definitions', async () => {
    const writer = new ProtoWriter();
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

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('message User {');
    expect(content).toContain('string id = 1;');
    expect(content).toContain('string name = 2;');
    expect(content).toContain('optional string bio = 3;');
    expect(content).toContain('repeated string tags = 4;');
  });

  test('generated content includes field comments', async () => {
    const writer = new ProtoWriter();
    const files = new Map<string, ProtoFile>();
    files.set('test', makeProtoFile({
      messages: [{
        name: 'User',
        fields: [
          { name: 'id', type: 'string', number: 1, optional: false, repeated: false, comment: 'Primary key' },
        ],
      }],
    }));

    await writer.writeProtoFiles(files, OUTPUT_DIR);

    const filePath = path.join(OUTPUT_DIR, 'myapp', 'user', 'v1', 'gen_types.proto');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('// Primary key');
  });
});
