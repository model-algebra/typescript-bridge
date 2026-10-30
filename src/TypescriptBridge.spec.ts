/*
 * Tests for TypescriptBridge
 */
import * as fs from 'node:fs';
import * as ts from 'typescript';
import { TypescriptBridge } from './TypescriptBridge';
import { Model } from 'model-algebra-common';

function loadModel(file: string): Model {
    return new Model(JSON.parse(fs.readFileSync(`src/examples/${file}`, 'utf-8')));
}

function makeModel(name: string, fields: any[], extra: Record<string, any> = {}): Model {
    return new Model({ metadata: { name, version: '1.0.0' }, fields, ...extra });
}

/** Type-checks generated code with strict settings; returns the compiler errors. */
function typeErrors(code: string): string[] {
    const fileName = 'generated.ts';
    const options: ts.CompilerOptions = {
        strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [],
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile;
    host.getSourceFile = (name, languageVersion, ...rest) => name === fileName
        ? ts.createSourceFile(name, code, languageVersion)
        : getSourceFile.call(host, name, languageVersion, ...rest);
    const program = ts.createProgram([fileName], options, host);
    return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** Compiles generated code to JavaScript and returns its exports. */
function load(code: string): Record<string, any> {
    const js = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as Record<string, any> };
    new Function('module', 'exports', js)(module, module.exports);
    return module.exports;
}

describe('TypescriptBridge output', () => {
    it('should generate interface, class and factory by default', () => {
        expect(new TypescriptBridge().toTarget(loadModel('user_core_model.json'))).toBe(
`export interface User {
    /** Main index */
    id: number;
    /** Login name */
    userName: string;
    /** First name */
    firstName: string;
    /** Second name */
    secondName: string | null;
}

export class UserEntity implements User {
    id: number;
    userName: string;
    firstName: string;
    secondName: string | null;

    constructor(data: User) {
        this.id = data.id;
        this.userName = data.userName;
        this.firstName = data.firstName;
        this.secondName = data.secondName;
    }

    /** Returns constraint violations; an empty list means the object is valid. */
    validate(): string[] {
        const errors: string[] = [];
        if (this.id == null) {
            errors.push("id is required");
        } else {
            if (!Number.isInteger(this.id)) errors.push("id must be an integer");
        }
        if (this.userName == null) errors.push("userName is required");
        if (this.firstName == null) errors.push("firstName is required");
        return errors;
    }
}

export class UserFactory {
    private readonly data: Partial<User>;

    constructor(initial: Partial<User> = {}) {
        this.data = { ...initial };
    }

    /** Sets one field; returns the factory for chaining. */
    set<K extends keyof User>(field: K, value: User[K]): this {
        this.data[field] = value;
        return this;
    }

    /** Field values set so far. */
    get values(): Partial<User> {
        return { ...this.data };
    }

    /** Required fields that are not set yet; nullable fields default to null. */
    missing(): Array<keyof User> {
        const required: Array<keyof User> = ["id", "userName", "firstName"];
        return required.filter(field => this.data[field] === undefined);
    }

    /** Builds the object; throws if required fields are missing. */
    build(): UserEntity {
        this.assertComplete();
        return new UserEntity({ secondName: null, ...this.data } as User);
    }

    private assertComplete(): void {
        const missing = this.missing();
        if (missing.length > 0)
            throw new Error("Cannot build User, missing: " + missing.join(", "));
    }
}`);
    });

    it('should generate only the interface when class and factory are disabled', () => {
        const code = new TypescriptBridge({ class: false, factory: false }).toTarget(loadModel('user_core_model.json'));
        expect(code).toMatch(/^export interface User \{/);
        expect(code).not.toContain('class ');
    });

    it('should build plain objects from the factory when the class is disabled', () => {
        const code = new TypescriptBridge({ class: false }).toTarget(loadModel('user_core_model.json'));
        expect(code).not.toContain('UserEntity');
        expect(code).toContain('    build(): User {');
        expect(typeErrors(code)).toEqual([]);
        const user = new (load(code).UserFactory)().set('id', 1).set('userName', 'u').set('firstName', 'f').build();
        expect(user).toEqual({ id: 1, userName: 'u', firstName: 'f', secondName: null });
    });

    it('should use the configured name suffixes', () => {
        const code = new TypescriptBridge({ classSuffix: 'Record', factorySuffix: 'Builder' }).toTarget(loadModel('user_core_model.json'));
        expect(code).toContain('export class UserRecord implements User {');
        expect(code).toContain('export class UserBuilder {');
        expect(code).toContain('    build(): UserRecord {');
    });

    it('should map all canonical types', () => {
        const code = new TypescriptBridge({ class: false, factory: false }).toTarget(loadModel('all_types_model.json'));
        expect(code.replace(/^\s*\/\*\*.*\*\/\n/gm, '')).toBe(
`export interface AllTypes {
    int32Field: number;
    int64Field: number;
    float32Field: number;
    float64Field: number;
    decimalField: number;
    booleanField: boolean;
    stringField: string;
    textField: string;
    uuidField: string;
    dateField: Date;
    timeField: Date;
    datetimeField: Date;
    timestampField: Date;
    timestampTzField: Date;
    durationField: string;
    objectField: User;
    enumField: "ACTIVE" | "INACTIVE" | "PENDING";
    unionField: string | number;
    jsonField: unknown;
}`);
    });

    it('should map INT16, BYTES, arrays and nullable arrays', () => {
        const code = new TypescriptBridge({ class: false, factory: false }).toTarget(makeModel('T', [
            { name: 'small', type: 'INT16' },
            { name: 'blob', type: 'BYTES' },
            { name: 'scores', type: 'ARRAY', parameters: { items: { type: 'INT32' } } },
            { name: 'days', type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['MON', 'TUE'] } } } },
            { name: 'tags', type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { nullable: true } },
        ]));
        expect(code).toBe(
`export interface T {
    small: number;
    blob: Uint8Array;
    scores: number[];
    days: ("MON" | "TUE")[];
    tags: string[] | null;
}`);
    });

    it('should convert model names to type names', () => {
        const code = new TypescriptBridge().toTarget(makeModel('order line', [
            { name: 'item', type: 'OBJECT', parameters: { ref: 'delivery type' } },
        ]));
        expect(code).toContain('export interface OrderLine {\n    item: DeliveryType;\n}');
        expect(code).toContain('export class OrderLineEntity implements OrderLine {');
        expect(code).toContain('export class OrderLineFactory {');
    });

    it('should write multi-line descriptions as JSDoc blocks and escape comment ends', () => {
        const model = makeModel('T', [{ name: 'a', type: 'TEXT', description: 'First line\nsecond */ line' }]);
        (model.metadata as any).description = 'Table';
        expect(new TypescriptBridge({ class: false, factory: false }).toTarget(model)).toBe(
`/** Table */
export interface T {
    /**
     * First line
     * second *\\/ line
     */
    a: string;
}`);
    });

    it('should generate code that type-checks for every valid example model', () => {
        const files = ['user_core_model.json', 'all_types_model.json', 'user_core_add_extended.json',
            'user_extended_model.json', ...fs.readdirSync('src/examples/shop_database').map(f => `shop_database/${f}`)];
        for (const options of [{}, { class: false }, { factory: false }, { class: false, factory: false }]) {
            const bridge = new TypescriptBridge(options);
            // Several examples model a User; keep the first of each name so the declarations stay unique
            const seen = new Set<string>();
            const code = files
                .map(file => bridge.toTarget(loadModel(file)))
                .filter(part => {
                    const name = part.match(/^export interface (\w+)/m)![1];
                    if (seen.has(name)) return false;
                    seen.add(name);
                    return true;
                })
                .join('\n\n');
            expect(typeErrors(code), JSON.stringify(options)).toEqual([]);
        }
    });
});

describe('generated validate()', () => {
    const model = makeModel('Item', [
        { name: 'id', type: 'INT32', constraints: { primaryKey: true, nullable: false } },
        { name: 'small', type: 'INT16', constraints: { nullable: true } },
        { name: 'code', type: 'STRING', parameters: { length: 5 }, constraints: { regex: '^[A-Z]+$', unique: true } },
        { name: 'qty', type: 'INT32', constraints: { min: 1, max: 10 } },
        { name: 'status', type: 'ENUM', parameters: { values: ['NEW', 'DONE'] } },
        { name: 'color', type: 'TEXT', constraints: { enum: ['red', 'green'], nullable: true } },
        { name: 'days', type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['MON', 'TUE'] } } } },
        { name: 'startDate', type: 'DATE' },
        { name: 'endDate', type: 'DATE', constraints: { nullable: true } },
        { name: 'ownerId', type: 'INT64', constraints: { foreignKey: { ref: 'User', field: 'id' } } },
    ], {
        constraints: [
            { name: 'ck_dates', type: 'check', rule: { field: 'endDate', op: '>=', otherField: 'startDate' } },
            { name: 'ck_start', type: 'check', rule: { field: 'startDate', op: '>=', value: '2020-01-01' } },
            { name: 'uq_code', type: 'unique', fields: ['code'] },
        ],
    });
    const code = new TypescriptBridge().toTarget(model);
    const { ItemEntity, ItemFactory } = load(code);
    const valid = {
        id: 1, small: null, code: 'ABC', qty: 5, status: 'NEW', color: null, days: ['MON'],
        startDate: new Date('2024-01-01'), endDate: new Date('2024-02-01'), ownerId: 7,
    };
    const errors = (changes: Record<string, any>) => new ItemEntity({ ...valid, ...changes }).validate();

    it('should type-check', () => {
        expect(typeErrors(code)).toEqual([]);
    });

    it('should accept a valid object', () => {
        expect(errors({})).toEqual([]);
    });

    it('should report each constraint violation', () => {
        expect(errors({ id: undefined })).toEqual(['id is required']);
        expect(errors({ id: 1.5 })).toEqual(['id must be an integer']);
        expect(errors({ id: 2 ** 31 })).toEqual(['id must be between -2147483648 and 2147483647']);
        expect(errors({ small: 40000 })).toEqual(['small must be between -32768 and 32767']);
        expect(errors({ code: 'ABCDEF' })).toEqual(['code must be at most 5 characters']);
        expect(errors({ code: 'abc' })).toEqual(['code must match ^[A-Z]+$']);
        expect(errors({ qty: 0 })).toEqual(['qty must be at least 1']);
        expect(errors({ qty: 11 })).toEqual(['qty must be at most 10']);
        expect(errors({ status: 'LOST' })).toEqual(['status must be one of "NEW", "DONE"']);
        expect(errors({ color: 'blue' })).toEqual(['color must be one of "red", "green"']);
        expect(errors({ days: ['MON', 'SUN'] })).toEqual(['days may only contain "MON", "TUE"']);
        expect(errors({ startDate: new Date('nonsense') })).toEqual(['startDate must be a valid date']);
        expect(errors({ endDate: new Date('2023-12-01') })).toEqual(['ck_dates failed: endDate >= startDate']);
        expect(errors({ startDate: new Date('2019-01-01'), endDate: null })).toEqual(['ck_start failed: startDate >= "2020-01-01"']);
    });

    it('should skip checks of nullable fields that are null', () => {
        expect(errors({ small: null, color: null, endDate: null })).toEqual([]);
    });

    it('should build objects incrementally with the factory', () => {
        const factory = new ItemFactory({ id: 1 });
        expect(factory.missing()).toEqual(['code', 'qty', 'status', 'days', 'startDate', 'ownerId']);
        expect(() => factory.build()).toThrow('Cannot build Item, missing: code, qty, status, days, startDate, ownerId');

        factory.set('code', 'ABC').set('qty', 5).set('status', 'NEW').set('days', []).set('startDate', new Date('2024-01-01'));
        expect(factory.values).toEqual({ id: 1, code: 'ABC', qty: 5, status: 'NEW', days: [], startDate: new Date('2024-01-01') });
        expect(factory.missing()).toEqual(['ownerId']);

        const item = factory.set('ownerId', 7).build();
        expect(item).toBeInstanceOf(ItemEntity);
        expect(item.small).toBeNull();
        expect(item.color).toBeNull();
        expect(item.endDate).toBeNull();
        expect(item.validate()).toEqual([]);
    });
});

describe('TypescriptBridge errors', () => {
    const bridge = new TypescriptBridge();
    const t = (fields: any[], extra?: Record<string, any>) => () => bridge.toTarget(makeModel('T', fields, extra));

    it('should reject unsupported types and invalid type parameters', () => {
        expect(t([{ name: 'a', type: 'MONEY' }])).toThrow('Unsupported field type: MONEY for field a');
        expect(t([{ name: 'a', type: 'ENUM' }])).toThrow('ENUM field a requires parameters.values');
        expect(t([{ name: 'a', type: 'UNION', parameters: { oneOf: [] } }])).toThrow('UNION field a requires non-empty parameters.oneOf');
        expect(t([{ name: 'a', type: 'ARRAY' }])).toThrow('ARRAY field a requires parameters.items with a type');
        expect(t([{ name: 'a', type: 'STRING', parameters: { length: '5' } }])).toThrow('Length of a must be a finite number');
    });

    it('should reject invalid names and unknown constraints', () => {
        expect(() => bridge.toTarget(makeModel('1st', []))).toThrow('Model name must be a valid TypeScript identifier');
        expect(t([{ name: 'first-name', type: 'TEXT' }])).toThrow('Field name must be a valid TypeScript identifier');
        expect(t([{ name: 'a', type: 'TEXT', constraints: { maxLength: 3 } }])).toThrow('Unsupported constraint: maxLength for field a');
        expect(t([{ name: 'a', type: 'TEXT', constraints: { nullable: 'yes' } }])).toThrow('Invalid value for nullable constraint of field a');
        expect(() => bridge.toTarget(new Model({ fields: [] }))).toThrow('Model name must be a string, got undefined');
    });

    it('should reject constraints that do not fit the field type', () => {
        expect(t([{ name: 'a', type: 'TEXT', constraints: { min: 1 } }])).toThrow('min and max constraints require a numeric type');
        expect(t([{ name: 'a', type: 'INT32', constraints: { max: '9' } }])).toThrow('Max of a must be a finite number');
        expect(t([{ name: 'a', type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { regex: 'x' } }]))
            .toThrow('regex constraint is not supported for ARRAY field a');
    });

    it('should reject invalid model-level check rules', () => {
        const fields = [{ name: 'a', type: 'INT32' }, { name: 'b', type: 'INT32' }];
        expect(t(fields, { constraints: [{ name: 'c', type: 'check' }] })).toThrow('has no rule');
        expect(t(fields, { constraints: [{ name: 'c', type: 'check', rule: { field: 'x', op: '>', value: 1 } }] }))
            .toThrow('Unknown field x in constraint c of T');
        expect(t(fields, { constraints: [{ name: 'c', type: 'check', rule: { field: 'a', op: '~', value: 1 } }] }))
            .toThrow('Unsupported operator ~');
        expect(t(fields, { constraints: [{ name: 'c', type: 'check', rule: { field: 'a', op: '>', value: 1, otherField: 'b' } }] }))
            .toThrow('exactly one of value or otherField');
        expect(t(fields, { constraints: [{ name: 'x', type: 'exclude', fields: ['a'] }] }))
            .toThrow('Unsupported table constraint type: exclude');
    });

    it('should keep toModel() as a stub', () => {
        expect(() => bridge.toModel('')).toThrow('not implemented yet');
    });
});
