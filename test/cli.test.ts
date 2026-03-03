import { test, expect, describe, afterAll } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';

const CLI_PATH = path.join(import.meta.dir, '..', 'src', 'cli.ts');
const FIXTURES_DIR = path.join(import.meta.dir, 'fixtures');
const OUTPUT_DIR = path.join(import.meta.dir, 'output', 'cli');

afterAll(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe('CLI - generate command', () => {
  test('generates proto files with default options', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'generate-default');
    const { stdout, exitCode } = await runCli([
      'generate',
      '-i', path.join(FIXTURES_DIR, 'basic'),
      '-o', outputDir,
      '-p', 'clitest',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Proto generation completed successfully');

    const protoPath = path.join(outputDir, 'clitest', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');
    expect(content).toContain('syntax = "proto3";');
    expect(content).toContain('package clitest.app.v1;');
  });

  test('exits with error for nonexistent input path', async () => {
    const { stderr, exitCode } = await runCli([
      'generate',
      '-i', '/nonexistent/path',
      '-o', path.join(OUTPUT_DIR, 'bad'),
      '-p', 'clitest',
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Input directory not found');
  });

  test('respects --no-google-timestamp flag', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'no-timestamp');
    const { exitCode } = await runCli([
      'generate',
      '-i', path.join(FIXTURES_DIR, 'basic'),
      '-o', outputDir,
      '-p', 'clitest',
      '--no-google-timestamp',
    ]);

    expect(exitCode).toBe(0);

    const protoPath = path.join(outputDir, 'clitest', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');
    expect(content).not.toContain('google.protobuf.Timestamp');
    expect(content).not.toContain('import "google/protobuf/timestamp.proto"');
  });

  test('uses snake_case field names by default', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'snake-case-default');
    const { exitCode } = await runCli([
      'generate',
      '-i', path.join(FIXTURES_DIR, 'basic'),
      '-o', outputDir,
      '-p', 'clitest',
    ]);

    expect(exitCode).toBe(0);

    const protoPath = path.join(outputDir, 'clitest', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');
    expect(content).toContain('created_at');
    expect(content).not.toContain('createdAt');
  });

  test('respects --camel-case flag', async () => {
    const outputDir = path.join(OUTPUT_DIR, 'camel-case');
    const { exitCode } = await runCli([
      'generate',
      '-i', path.join(FIXTURES_DIR, 'basic'),
      '-o', outputDir,
      '-p', 'clitest',
      '--camel-case',
    ]);

    expect(exitCode).toBe(0);

    const protoPath = path.join(outputDir, 'clitest', 'app', 'v1', 'gen_types.proto');
    const content = await fs.readFile(protoPath, 'utf-8');
    expect(content).toContain('createdAt');
    expect(content).not.toContain('created_at');
  });
});

describe('CLI - init command', () => {
  test('creates a config file template', async () => {
    const configPath = path.join(OUTPUT_DIR, 'init-test', 'proto.config.js');
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    const { stdout, exitCode } = await runCli([
      'init',
      '-o', configPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Created configuration file');

    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('inputPath');
    expect(content).toContain('outputPath');
    expect(content).toContain('protoPackageName');
  });

  test('refuses to overwrite existing config file', async () => {
    const configPath = path.join(OUTPUT_DIR, 'init-exists', 'proto.config.js');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'existing content', 'utf-8');

    const { stderr, exitCode } = await runCli([
      'init',
      '-o', configPath,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('File already exists');
  });
});
