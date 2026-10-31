# typescript-bridge

Generates TypeScript from [model-algebra](https://github.com/model-algebra/model-algebra) models: an interface, a
class with a `validate()` method checking the constraints of the model, and a factory that builds objects step by
step.

## Installation

```sh
pnpm add github:model-algebra/typescript-bridge
```

The built package is in the repository, so nothing is built when it is installed.

## Usage

```ts
import { TypescriptBridge } from 'typescript-bridge'

const code = new TypescriptBridge().toTarget(model)   // TypeScript source text
```

For this model:

```json
{
  "metadata": { "name": "User", "version": "1.0.0" },
  "fields": [
    { "name": "id", "type": "INT64", "constraints": { "primaryKey": true } },
    { "name": "email", "type": "STRING", "description": "Login", "parameters": { "length": 100 }, "constraints": { "regex": "^[^@]+@[^@]+$" } },
    { "name": "age", "type": "INT16", "constraints": { "min": 0, "nullable": true } }
  ]
}
```

it generates (`validate()` and the factory shortened):

```ts
export interface User {
    id: number;
    /** Login */
    email: string;
    age: number | null;
}

export class UserEntity implements User {
    // fields and a constructor taking a User

    /** Returns constraint violations; an empty list means the object is valid. */
    validate(): string[] {
        const errors: string[] = [];
        if (this.id == null) {
            errors.push("id is required");
        } else {
            if (!Number.isInteger(this.id)) errors.push("id must be an integer");
        }
        if (this.email == null) {
            errors.push("email is required");
        } else {
            if (this.email.length > 100) errors.push("email must be at most 100 characters");
            if (!new RegExp("^[^@]+@[^@]+$").test(String(this.email))) errors.push("email must match ^[^@]+@[^@]+$");
        }
        if (this.age != null) {
            if (!Number.isInteger(this.age)) errors.push("age must be an integer");
            if (this.age < -32768 || this.age > 32767) errors.push("age must be between -32768 and 32767");
            if (this.age < 0) errors.push("age must be at least 0");
        }
        return errors;
    }
}

export class UserFactory {
    constructor(initial: Partial<User> = {})
    set<K extends keyof User>(field: K, value: User[K]): this   // chainable
    get values(): Partial<User>
    missing(): Array<keyof User>                                 // required fields not set yet
    build(): UserEntity                                          // throws if fields are missing
}
```

## Options

```ts
new TypescriptBridge({ class: true, factory: true, classSuffix: 'Entity', factorySuffix: 'Factory' })
```

| Option | Default | |
|---|---|---|
| `class` | `true` | Generate the class with `validate()` |
| `factory` | `true` | Generate the factory; without the class, `build()` returns plain objects |
| `classSuffix` | `Entity` | Appended to the model name for the class |
| `factorySuffix` | `Factory` | Appended to the model name for the factory |

Model names become type names: `User db model` becomes `UserDbModel`.

## Types

| Model type | TypeScript |
|---|---|
| `INT16`, `INT32`, `INT64`, `FLOAT32`, `FLOAT64`, `DECIMAL`, `integer`, `number` | `number` |
| `STRING`, `TEXT`, `UUID`, `DURATION` (ISO 8601), `string` | `string` |
| `BOOLEAN`, `boolean` | `boolean` |
| `BYTES` | `Uint8Array` |
| `DATE`, `TIME`, `DATETIME`, `TIMESTAMP`, `TIMESTAMP_TZ`, `date` | `Date` |
| `ENUM` | Union of the values, e.g. `"ACTIVE" \| "INACTIVE"` |
| `OBJECT` | The type of the referenced model, e.g. `Address` |
| `UNION` | Union of the types it lists |
| `ARRAY` | Array of the items' type |
| `JSON` | `unknown` |

Fields are required unless they are `nullable: true`, which adds `| null`.

## What validate() checks

| Constraint | Check |
|---|---|
| `nullable` | A value is required, unless the field is nullable |
| Integer types | Whole numbers, within the range of `INT16` and `INT32` |
| `STRING` `length` | Maximum length |
| Date types | A valid date |
| `min`, `max` | Range; numeric types only |
| `enum`, or an `ENUM` type | One of the values, for every item of an array |
| `regex` | Pattern |
| Table `check` rules | The comparison |

`primaryKey`, `unique`, `foreignKey`, `identity`, `default` and `required` need other records or the database, so
they are not checked. Unknown constraints, and constraints that don't fit the field type, are rejected.

`toModel()`, reading TypeScript back into a model, is not implemented.

## Development

```sh
git submodule update --init   # src/examples
pnpm install
pnpm test
pnpm build
```

`dist/` is committed, because other projects install the package from GitHub without building it. Enable the
pre-commit hook once per clone; it rebuilds `dist/` and adds it to every commit that changes the sources:

```sh
git config core.hooksPath .githooks
```

CI fails when the committed `dist/` differs from a build of the sources.

The tests compile the generated code with the TypeScript compiler, for every valid example model.

## License

MIT
