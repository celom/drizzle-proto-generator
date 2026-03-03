import { test, expect, describe, afterAll } from 'bun:test';
import { ProtoReader } from '../src/reader/proto-reader';
import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUT_DIR = path.join(import.meta.dir, 'output', 'proto-reader');

afterAll(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
});

describe('ProtoReader - parseProtoContent', () => {
  const reader = new ProtoReader();

  test('extracts package name', () => {
    const content = `syntax = "proto3";\npackage myapp.user.v1;\n`;
    const { packageName } = reader.parseProtoContent(content);
    expect(packageName).toBe('myapp.user.v1');
  });

  test('returns null package for content without package declaration', () => {
    const content = `syntax = "proto3";\n`;
    const { packageName } = reader.parseProtoContent(content);
    expect(packageName).toBeNull();
  });

  test('extracts message field numbers', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

message User {
  string id = 1;
  string name = 3;
  optional string bio = 5;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const userFields = fieldMap.messages.get('User');
    expect(userFields).toBeDefined();
    expect(userFields!.get('id')).toBe(1);
    expect(userFields!.get('name')).toBe(3);
    expect(userFields!.get('bio')).toBe(5);
  });

  test('handles optional and repeated field modifiers', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

message User {
  string id = 1;
  optional string bio = 2;
  repeated string tags = 3;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const userFields = fieldMap.messages.get('User');
    expect(userFields!.get('id')).toBe(1);
    expect(userFields!.get('bio')).toBe(2);
    expect(userFields!.get('tags')).toBe(3);
  });

  test('handles fully qualified types like google.protobuf.Timestamp', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

message User {
  string id = 1;
  google.protobuf.Timestamp createdAt = 2;
  optional google.type.Date birthDate = 3;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const userFields = fieldMap.messages.get('User');
    expect(userFields!.get('id')).toBe(1);
    expect(userFields!.get('createdAt')).toBe(2);
    expect(userFields!.get('birthDate')).toBe(3);
  });

  test('extracts enum value numbers', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

enum UserRole {
  USER_ROLE_UNSPECIFIED = 0;
  USER_ROLE_ADMIN = 1;
  USER_ROLE_VIEWER = 2;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const enumValues = fieldMap.enums.get('UserRole');
    expect(enumValues).toBeDefined();
    expect(enumValues!.get('USER_ROLE_UNSPECIFIED')).toBe(0);
    expect(enumValues!.get('USER_ROLE_ADMIN')).toBe(1);
    expect(enumValues!.get('USER_ROLE_VIEWER')).toBe(2);
  });

  test('parses reserved number directives in messages', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

message User {
  reserved 3, 5;
  string id = 1;
  string name = 2;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const reserved = fieldMap.messageReservedNumbers.get('User');
    expect(reserved).toEqual([3, 5]);
  });

  test('parses reserved name directives in messages', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

message User {
  reserved "bio", "avatar";
  string id = 1;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    const reserved = fieldMap.messageReservedNames.get('User');
    expect(reserved).toEqual(['bio', 'avatar']);
  });

  test('parses reserved directives in enums', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

enum Status {
  reserved 3;
  reserved "STATUS_DELETED";

  STATUS_UNSPECIFIED = 0;
  STATUS_ACTIVE = 1;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    expect(fieldMap.enumReservedNumbers.get('Status')).toEqual([3]);
    expect(fieldMap.enumReservedNames.get('Status')).toEqual(['STATUS_DELETED']);
  });

  test('handles multiple messages and enums in one file', () => {
    const content = `
syntax = "proto3";
package myapp.v1;

enum UserRole {
  USER_ROLE_UNSPECIFIED = 0;
  USER_ROLE_ADMIN = 1;
}

message User {
  string id = 1;
  string name = 2;
}

message Post {
  string id = 1;
  string title = 2;
  string authorId = 3;
}
`;
    const { fieldMap } = reader.parseProtoContent(content);
    expect(fieldMap.messages.size).toBe(2);
    expect(fieldMap.enums.size).toBe(1);
    expect(fieldMap.messages.get('User')!.get('id')).toBe(1);
    expect(fieldMap.messages.get('Post')!.get('authorId')).toBe(3);
    expect(fieldMap.enums.get('UserRole')!.get('USER_ROLE_ADMIN')).toBe(1);
  });

  test('handles empty content', () => {
    const { packageName, fieldMap } = reader.parseProtoContent('');
    expect(packageName).toBeNull();
    expect(fieldMap.messages.size).toBe(0);
    expect(fieldMap.enums.size).toBe(0);
  });
});

describe('ProtoReader - readExistingProtos', () => {
  const reader = new ProtoReader();

  test('reads proto files from output directory', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'read-test');
    const protoDir = path.join(outputDir, 'myapp', 'user', 'v1');
    await fs.mkdir(protoDir, { recursive: true });
    await fs.writeFile(
      path.join(protoDir, 'gen_types.proto'),
      `syntax = "proto3";\npackage myapp.user.v1;\n\nmessage User {\n  string id = 1;\n  string name = 3;\n}\n`,
    );

    const registry = await reader.readExistingProtos(outputDir);
    expect(registry.size).toBe(1);
    expect(registry.has('myapp.user.v1')).toBe(true);
    const userFields = registry.get('myapp.user.v1')!.messages.get('User');
    expect(userFields!.get('id')).toBe(1);
    expect(userFields!.get('name')).toBe(3);
  });

  test('returns empty registry for nonexistent directory', async () => {
    const registry = await reader.readExistingProtos('/nonexistent/path');
    expect(registry.size).toBe(0);
  });
});
