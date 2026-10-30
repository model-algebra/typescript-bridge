import type { ModelBridge, Model, Rule } from "model-algebra-common";

export interface TypescriptBridgeOptions {
    /** Generate a class implementing the interface, with a validate() method (default: true). */
    class?: boolean;
    /** Generate a factory that builds an object incrementally from a Partial of the interface (default: true). */
    factory?: boolean;
    /** Appended to the model name to name the class (default: "Entity"). */
    classSuffix?: string;
    /** Appended to the model name to name the factory (default: "Factory"). */
    factorySuffix?: string;
}

type FieldData = Record<string, any>;
type TypeDescriptor = { type: string, parameters?: Record<string, any> };

interface FieldInfo {
    name: string;
    /** TypeScript type of the property, including `| null` for nullable fields */
    type: string;
    nullable: boolean;
    description?: string;
    data: FieldData;
}

/** A check made by validate(): the generated condition is true when the value violates the constraint. */
type Violation = { condition: string, message: string };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Integer types with the range of values they can hold; INT64 and integer are limited only by Number
const INTEGER_RANGES = new Map<string, [number, number] | undefined>([
    ['integer', undefined],
    ['INT16', [-32768, 32767]],
    ['INT32', [-2147483648, 2147483647]],
    ['INT64', undefined],
]);

const NUMERIC_TYPES = new Set([...INTEGER_RANGES.keys(), 'number', 'FLOAT32', 'FLOAT64', 'DECIMAL']);

const DATE_TYPES = new Set(['date', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP_TZ']);

const CHECKED_CONSTRAINTS = new Set(['nullable', 'min', 'max', 'enum', 'regex']);

// Constraints that need other objects or the database to check, or that describe storage only
const UNCHECKED_CONSTRAINTS = new Set(['primaryKey', 'unique', 'foreignKey', 'foreign_key', 'identity', 'default', 'required']);

const RULE_OPERATORS: Record<string, string> = {
    '=': '===', '!=': '!==', '<': '<', '<=': '<=', '>': '>', '>=': '>=',
};

function identifier(name: unknown, what: string): string {
    if (typeof name !== 'string' || !IDENTIFIER.test(name))
        throw new Error(`${what} must be a valid TypeScript identifier, got ${JSON.stringify(name)}`);
    return name;
}

/** Model name to a type name: "User db model" -> "UserDbModel"; names that are already PascalCase are kept. */
function typeName(name: unknown, what: string): string {
    if (typeof name !== 'string')
        throw new Error(`${what} must be a string, got ${JSON.stringify(name)}`);
    const words = name.split(/[^A-Za-z0-9_$]+/).filter(word => word.length > 0);
    return identifier(words.map(word => word[0].toUpperCase() + word.slice(1)).join(''), what);
}

function numberLiteral(value: unknown, what: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${what} must be a finite number, got ${JSON.stringify(value)}`);
    return String(value);
}

function jsDoc(text: string | undefined, indent: string): string[] {
    if (text === undefined) return [];
    const lines = text.replace(/\*\//g, '*\\/').split('\n');
    return lines.length === 1
        ? [`${indent}/** ${lines[0]} */`]
        : [`${indent}/**`, ...lines.map(line => `${indent} * ${line}`), `${indent} */`];
}

/**
 * Generates TypeScript source from a model: an interface, and optionally a class with a validate() method
 * and a factory that collects field values before building the object.
 */
export class TypescriptBridge implements ModelBridge<Model, string> {

    private readonly options: Required<TypescriptBridgeOptions>;

    constructor(options: TypescriptBridgeOptions = {}) {
        this.options = {
            class: options.class ?? true,
            factory: options.factory ?? true,
            classSuffix: options.classSuffix ?? 'Entity',
            factorySuffix: options.factorySuffix ?? 'Factory',
        };
    }

    toTarget(model: Model): string {
        const name = typeName(model.metadata?.name, 'Model name');
        const fields = model.fields.map(field => this.fieldInfo(field as FieldData));
        const parts = [this.interfaceCode(model, name, fields)];
        if (this.options.class)
            parts.push(this.classCode(model, name, fields));
        if (this.options.factory)
            parts.push(this.factoryCode(name, fields));
        return parts.join('\n\n');
    }

    toModel(_typescript: string): Model {
        throw new Error("TypescriptBridge.toModel() is not implemented yet");
    }

    private fieldInfo(field: FieldData): FieldInfo {
        const name = identifier(field.name, 'Field name');
        const constraints = field.constraints ?? {};
        for (const key of Object.keys(constraints))
            if (!CHECKED_CONSTRAINTS.has(key) && !UNCHECKED_CONSTRAINTS.has(key))
                throw new Error(`Unsupported constraint: ${key} for field ${name}`);
        if (constraints.nullable !== undefined && typeof constraints.nullable !== 'boolean')
            throw new Error(`Invalid value for nullable constraint of field ${name}: ${JSON.stringify(constraints.nullable)}. Expected true or false.`);
        const nullable = constraints.nullable === true;
        const type = this.tsType(field as TypeDescriptor, name);
        return { name, type: nullable ? `${type} | null` : type, nullable, description: field.description, data: field };
    }

    private tsType(descriptor: TypeDescriptor, fieldName: string): string {
        const params = descriptor.parameters ?? {};
        switch (descriptor.type) {
            case 'integer':
            case 'INT16':
            case 'INT32':
            case 'INT64':
            case 'number':
            case 'FLOAT32':
            case 'FLOAT64':
            case 'DECIMAL':
                return 'number';
            case 'string':
            case 'STRING':
            case 'TEXT':
            case 'UUID':
            case 'DURATION':    // ISO 8601 duration, e.g. "P1DT2H"
                return 'string';
            case 'boolean':
            case 'BOOLEAN':
                return 'boolean';
            case 'BYTES':
                return 'Uint8Array';
            case 'date':
            case 'DATE':
            case 'TIME':
            case 'DATETIME':
            case 'TIMESTAMP':
            case 'TIMESTAMP_TZ':
                return 'Date';
            case 'JSON':
                return 'unknown';
            case 'object':
                return 'Record<string, unknown>';
            case 'array':
                return 'unknown[]';
            case 'OBJECT':
                return params.ref !== undefined
                    ? typeName(params.ref, `Reference of field ${fieldName}`)
                    : 'Record<string, unknown>';
            case 'ENUM':
                return this.enumValues(params, fieldName).map(value => JSON.stringify(value)).join(' | ');
            case 'UNION':
                if (!Array.isArray(params.oneOf) || params.oneOf.length === 0)
                    throw new Error(`UNION field ${fieldName} requires non-empty parameters.oneOf`);
                return params.oneOf.map((option: TypeDescriptor) => this.tsType(option, fieldName)).join(' | ');
            case 'ARRAY': {
                const items = params.items;
                if (items === null || typeof items !== 'object' || typeof items.type !== 'string')
                    throw new Error(`ARRAY field ${fieldName} requires parameters.items with a type`);
                const itemType = this.tsType(items, fieldName);
                return itemType.includes(' ') ? `(${itemType})[]` : `${itemType}[]`;
            }
            default:
                throw new Error(`Unsupported field type: ${descriptor.type} for field ${fieldName}`);
        }
    }

    private enumValues(params: Record<string, any>, fieldName: string): string[] {
        const values = params.values;
        if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== 'string'))
            throw new Error(`ENUM field ${fieldName} requires parameters.values with at least one string`);
        return values;
    }

    private interfaceCode(model: Model, name: string, fields: FieldInfo[]): string {
        const lines = [...jsDoc(model.metadata.description, ''), `export interface ${name} {`];
        for (const field of fields)
            lines.push(...jsDoc(field.description, '    '), `    ${field.name}: ${field.type};`);
        lines.push('}');
        return lines.join('\n');
    }

    private classCode(model: Model, name: string, fields: FieldInfo[]): string {
        const className = identifier(name + this.options.classSuffix, 'Class name');
        return [
            `export class ${className} implements ${name} {`,
            ...fields.map(field => `    ${field.name}: ${field.type};`),
            '',
            `    constructor(data: ${name}) {`,
            ...fields.map(field => `        this.${field.name} = data.${field.name};`),
            '    }',
            '',
            '    /** Returns constraint violations; an empty list means the object is valid. */',
            '    validate(): string[] {',
            '        const errors: string[] = [];',
            ...fields.flatMap(field => this.fieldChecks(field)),
            ...this.ruleChecks(model, fields),
            '        return errors;',
            '    }',
            '}',
        ].join('\n');
    }

    private fieldChecks(field: FieldInfo): string[] {
        const value = `this.${field.name}`;
        const violations = this.violations(field, value);
        const push = (indent: string) =>
            violations.map(v => `${indent}if (${v.condition}) errors.push(${JSON.stringify(v.message)});`);
        const required = `errors.push(${JSON.stringify(`${field.name} is required`)});`;

        if (field.nullable)
            return violations.length === 0 ? [] : [`        if (${value} != null) {`, ...push('            '), '        }'];
        if (violations.length === 0)
            return [`        if (${value} == null) ${required}`];
        return [`        if (${value} == null) {`, `            ${required}`, '        } else {', ...push('            '), '        }'];
    }

    private violations(field: FieldInfo, value: string): Violation[] {
        const { name, data } = field;
        const constraints = data.constraints ?? {};
        const params = data.parameters ?? {};
        const isArray = data.type === 'ARRAY';
        const violations: Violation[] = [];

        if (INTEGER_RANGES.has(data.type)) {
            violations.push({ condition: `!Number.isInteger(${value})`, message: `${name} must be an integer` });
            const range = INTEGER_RANGES.get(data.type);
            if (range !== undefined)
                violations.push({
                    condition: `${value} < ${range[0]} || ${value} > ${range[1]}`,
                    message: `${name} must be between ${range[0]} and ${range[1]}`,
                });
        }
        if (DATE_TYPES.has(data.type))
            violations.push({ condition: `Number.isNaN(${value}.getTime())`, message: `${name} must be a valid date` });
        if (data.type === 'STRING' && params.length !== undefined) {
            const length = numberLiteral(params.length, `Length of ${name}`);
            violations.push({ condition: `${value}.length > ${length}`, message: `${name} must be at most ${length} characters` });
        }

        if ((constraints.min !== undefined || constraints.max !== undefined) && !NUMERIC_TYPES.has(data.type))
            throw new Error(`min and max constraints require a numeric type, field ${name} has type ${data.type}`);
        if (constraints.min !== undefined) {
            const min = numberLiteral(constraints.min, `Min of ${name}`);
            violations.push({ condition: `${value} < ${min}`, message: `${name} must be at least ${min}` });
        }
        if (constraints.max !== undefined) {
            const max = numberLiteral(constraints.max, `Max of ${name}`);
            violations.push({ condition: `${value} > ${max}`, message: `${name} must be at most ${max}` });
        }

        const allowed = this.allowedValues(data, name);
        if (allowed !== undefined) {
            const list = `(${JSON.stringify(allowed)} as unknown[])`;
            const description = allowed.map(item => JSON.stringify(item)).join(', ');
            violations.push(isArray
                ? { condition: `!${value}.every(item => ${list}.includes(item))`, message: `${name} may only contain ${description}` }
                : { condition: `!${list}.includes(${value})`, message: `${name} must be one of ${description}` });
        }

        if (constraints.regex !== undefined) {
            if (isArray)
                throw new Error(`regex constraint is not supported for ARRAY field ${name}`);
            if (typeof constraints.regex !== 'string')
                throw new Error(`Regex of ${name} must be a string`);
            violations.push({
                condition: `!new RegExp(${JSON.stringify(constraints.regex)}).test(String(${value}))`,
                message: `${name} must match ${constraints.regex}`,
            });
        }
        return violations;
    }

    /** Values allowed by the enum constraint, or by the ENUM type of the field or of the items of an ARRAY field. */
    private allowedValues(data: FieldData, name: string): unknown[] | undefined {
        const constraint = data.constraints?.enum;
        if (constraint !== undefined) {
            if (!Array.isArray(constraint) || constraint.length === 0)
                throw new Error(`enum constraint of field ${name} must be a non-empty array`);
            return constraint;
        }
        const typed = data.type === 'ARRAY' ? data.parameters?.items : data;
        return typed?.type === 'ENUM' ? this.enumValues(typed.parameters ?? {}, name) : undefined;
    }

    /** Checks for model-level check constraints; primaryKey and unique need other objects and are not checked. */
    private ruleChecks(model: Model, fields: FieldInfo[]): string[] {
        const byName = new Map(fields.map(field => [field.name, field]));
        const lines: string[] = [];
        for (const constraint of model.constraints ?? []) {
            if (constraint.type === 'primaryKey' || constraint.type === 'unique') continue;
            if (constraint.type !== 'check')
                throw new Error(`Unsupported table constraint type: ${(constraint as any).type} in ${model.metadata.name}`);
            const where = `constraint ${constraint.name} of ${model.metadata.name}`;
            if (constraint.rule === undefined)
                throw new Error(`Check constraint ${constraint.name} of ${model.metadata.name} has no rule`);
            lines.push(`        if (${this.ruleViolation(constraint.rule, byName, where)}) ` +
                `errors.push(${JSON.stringify(`${constraint.name} failed: ${this.ruleText(constraint.rule)}`)});`);
        }
        return lines;
    }

    private ruleViolation(rule: Rule, fields: Map<string, FieldInfo>, where: string): string {
        const op = RULE_OPERATORS[rule.op];
        if (op === undefined)
            throw new Error(`Unsupported operator ${rule.op} in ${where}`);
        if ((rule.value !== undefined) === (rule.otherField !== undefined))
            throw new Error(`Rule in ${where} must have exactly one of value or otherField`);
        if (rule.value === null)
            throw new Error(`Rule in ${where} cannot compare with null; use the nullable constraint`);

        const field = this.ruleField(rule.field, fields, where);
        const other = rule.otherField !== undefined ? this.ruleField(rule.otherField, fields, where) : undefined;
        const isDate = DATE_TYPES.has(field.data.type);
        const operand = (f: FieldInfo) => DATE_TYPES.has(f.data.type) ? `this.${f.name}.getTime()` : `this.${f.name}`;
        const right = other !== undefined
            ? operand(other)
            : isDate ? `new Date(${JSON.stringify(rule.value)}).getTime()` : JSON.stringify(rule.value);
        // Missing values and invalid dates are reported by the field checks, not again by the rule
        const guards = [field, ...(other !== undefined ? [other] : [])].map(f => DATE_TYPES.has(f.data.type)
            ? `this.${f.name} != null && !Number.isNaN(this.${f.name}.getTime())`
            : `this.${f.name} != null`);
        return `${guards.join(' && ')} && !(${operand(field)} ${op} ${right})`;
    }

    private ruleField(name: string, fields: Map<string, FieldInfo>, where: string): FieldInfo {
        const field = fields.get(name);
        if (field === undefined)
            throw new Error(`Unknown field ${name} in ${where}`);
        return field;
    }

    private ruleText(rule: Rule): string {
        return `${rule.field} ${rule.op} ${rule.otherField ?? JSON.stringify(rule.value)}`;
    }

    private factoryCode(name: string, fields: FieldInfo[]): string {
        const factoryName = identifier(name + this.options.factorySuffix, 'Factory name');
        const required = fields.filter(field => !field.nullable).map(field => JSON.stringify(field.name));
        const nullDefaults = fields.filter(field => field.nullable).map(field => `${field.name}: null, `).join('');
        const data = `{ ${nullDefaults}...this.data }`;
        const build = this.options.class
            ? [`    build(): ${name}${this.options.classSuffix} {`, '        this.assertComplete();', `        return new ${name}${this.options.classSuffix}(${data} as ${name});`]
            : [`    build(): ${name} {`, '        this.assertComplete();', `        return ${data} as ${name};`];
        return [
            `export class ${factoryName} {`,
            `    private readonly data: Partial<${name}>;`,
            '',
            `    constructor(initial: Partial<${name}> = {}) {`,
            '        this.data = { ...initial };',
            '    }',
            '',
            '    /** Sets one field; returns the factory for chaining. */',
            `    set<K extends keyof ${name}>(field: K, value: ${name}[K]): this {`,
            '        this.data[field] = value;',
            '        return this;',
            '    }',
            '',
            '    /** Field values set so far. */',
            `    get values(): Partial<${name}> {`,
            '        return { ...this.data };',
            '    }',
            '',
            '    /** Required fields that are not set yet; nullable fields default to null. */',
            `    missing(): Array<keyof ${name}> {`,
            `        const required: Array<keyof ${name}> = [${required.join(', ')}];`,
            '        return required.filter(field => this.data[field] === undefined);',
            '    }',
            '',
            '    /** Builds the object; throws if required fields are missing. */',
            ...build,
            '    }',
            '',
            '    private assertComplete(): void {',
            '        const missing = this.missing();',
            '        if (missing.length > 0)',
            `            throw new Error(${JSON.stringify(`Cannot build ${name}, missing: `)} + missing.join(", "));`,
            '    }',
            '}',
        ].join('\n');
    }
}
