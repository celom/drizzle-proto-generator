# drizzle-proto-generator

**Drizzle schema as the source of truth. Proto files as the output.**

Generate gRPC Protocol Buffer definitions from [Drizzle ORM](https://orm.drizzle.team/) schemas. Works by statically analyzing your TypeScript schema files — Drizzle is **not** imported at runtime.

## Why not proto-first?

Proto-first is the right call when multiple teams in different languages independently consume your API. But if your stack is TypeScript and your data model lives in Drizzle, hand-writing `.proto` files means maintaining two sources of truth for the same structure. Every column you add, rename, or remove requires a matching edit in your protos — that's not safety, it's bookkeeping.

This tool eliminates that duplication — think tRPC's philosophy applied to gRPC. The generated `.proto` files are fully standard — any language can consume them. You're not giving up interop, you're skipping the ceremony.

**Use this if:**
- Your backend is TypeScript with Drizzle ORM
- You want gRPC's performance and type safety without maintaining proto files by hand
- You're in a monorepo where Drizzle schemas are the canonical data model

**Use proto-first if:**
- Multiple teams in different languages define and consume the API contract
- Your `.proto` files contain service definitions, RPCs, and custom options beyond data types
- You need fine-grained control over wire format and field numbering

## Installation

```bash
# npm
npm install drizzle-proto-generator

# pnpm
pnpm add drizzle-proto-generator

# yarn
yarn add drizzle-proto-generator

# bun
bun add drizzle-proto-generator
```

## Quick Start

### CLI

```bash
npx drizzle-proto-generator generate -i ./src/schema -o ./proto -p myapp
```

### Programmatic API

```typescript
import { ProtoGenRunner } from 'drizzle-proto-generator';

const runner = new ProtoGenRunner({
  inputPath: './src/schema',
  outputPath: './proto',
  protoPackageName: 'myapp',
});

await runner.run();
```

## CLI Reference

### `generate`

Generate `.proto` files from Drizzle schemas.

```bash
drizzle-proto-generator generate [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-i, --input <path>` | `src/schema` | Path to Drizzle schema directory |
| `-o, --output <path>` | `proto` | Output directory for proto files |
| `-p, --package <name>` | `proto` | Base package name for proto files |
| `--enum-prefix <prefix>` | `PROTO` | Prefix for enum values |
| `--no-unspecified` | | Do not add `UNSPECIFIED` enum value |
| `--no-google-timestamp` | | Use `string` instead of `google.protobuf.Timestamp` for date/time fields |
| `--google-date` | | Use `google.type.Date` for date fields |
| `--google-struct` | | Use `google.protobuf.Struct` for json/jsonb fields |
| `--preserve-snake-case` | | Preserve snake_case in field names |
| `--no-comments` | | Do not generate comments |
| `-c, --config <path>` | | Path to configuration file |

### `init`

Create a configuration file template.

```bash
drizzle-proto-generator init [-o proto.config.js]
```

## Configuration

You can use a configuration file instead of CLI flags:

```bash
drizzle-proto-generator init
```

This creates a `proto.config.js`:

```javascript
export default {
  inputPath: './src/schema',
  outputPath: './proto',
  protoPackageName: 'myapp',
  options: {
    useGoogleTimestamp: true,
    useGoogleDate: false,
    useGoogleStruct: false,
    enumPrefix: 'PROTO',
    addUnspecified: true,
    preserveSnakeCase: false,
    generateComments: true,
  },
};
```

Then run:

```bash
drizzle-proto-generator generate -c proto.config.js
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `inputPath` | `string` | — | Path to your Drizzle schema files |
| `outputPath` | `string` | — | Output directory for generated proto files |
| `protoPackageName` | `string` | — | Base package name for proto files |
| `packageResolvers` | `Record<string, string>` | `{}` | Map package names to paths (for monorepos) |
| `options.useGoogleTimestamp` | `boolean` | `true` | Use `google.protobuf.Timestamp` for timestamp/time fields |
| `options.useGoogleDate` | `boolean` | `false` | Use `google.type.Date` for date fields |
| `options.useGoogleStruct` | `boolean` | `false` | Use `google.protobuf.Struct` for json/jsonb fields |
| `options.enumPrefix` | `string` | `''` | Prefix for enum values (CLI default: `PROTO`) |
| `options.addUnspecified` | `boolean` | `true` | Add `UNSPECIFIED = 0` as the first enum value |
| `options.preserveSnakeCase` | `boolean` | `false` | Keep snake_case in field names |
| `options.generateComments` | `boolean` | `true` | Generate comments in proto files |

## Type Mapping

| Drizzle Type | Proto Type |
|---|---|
| `varchar`, `text`, `char` | `string` |
| `integer`, `serial`, `smallint` | `int32` |
| `bigint`, `bigserial` | `int64` |
| `real`, `float4` | `float` |
| `double`, `float8`, `numeric`, `decimal` | `double` |
| `boolean` | `bool` |
| `timestamp`, `time` | `google.protobuf.Timestamp` (or `string`) |
| `date` | `google.protobuf.Timestamp` (or `google.type.Date` / `string`) |
| `json`, `jsonb` | `string` (or `google.protobuf.Struct`) |
| `uuid` | `string` |
| `bytea`, `blob`, `binary` | `bytes` |
| `inet`, `cidr`, `macaddr` | `string` |
| `pgEnum(...)` | Proto `enum` |

## Monorepo Support

If your Drizzle schemas import types from other packages in a monorepo, use `packageResolvers` to map package names to file paths:

```typescript
const runner = new ProtoGenRunner({
  inputPath: './src/schema',
  outputPath: './proto',
  protoPackageName: 'myapp',
  packageResolvers: {
    '@myorg/shared-schema': 'packages/shared/src/index.ts',
  },
});
```

The tool automatically detects workspace roots for pnpm, npm, yarn, bun, nx, turborepo, and lerna.

## How It Works

1. **Parse** — Uses [ts-morph](https://ts-morph.com/) to statically analyze your Drizzle schema TypeScript files, extracting table definitions, column types, enums, and schema groupings.
2. **Generate** — Converts the parsed schema into Protocol Buffer message and enum definitions with correct field numbering and type mapping.
3. **Write** — Outputs `.proto` files organized by schema: `<output>/<package>/<schema>/v1/gen_types.proto`

## License

[MIT](LICENSE)
