import { Model } from "./Model";

type Field = Record<string, any>;
export class TypescriptBridge {

    toTypescript(model: Model): string {
        return `class ${model.metadata.name} {\n` + model.fields.map(field => this.convertField(field)).join('\n') + `\n}`;
    }

    getConstraintProcessor(name: string, value: any): ConstraintProcessorI {
        switch (name) {
            case 'nullable':
                return new NullableConstraintProcessor(value);
            case 'primaryKey':
                return new PrimaryKeyConstraintProcessor(value);
            default:
                throw new Error(`Unsupported constraint: ${name}`);
        }
    }

    getConstraintProcessors(field: Field): ConstraintProcessorI[] {
        const processors: ConstraintProcessorI[] = [];
        if (field.constraints) {
            for (const name in field.constraints) {
                processors.push(this.getConstraintProcessor(name, field.constraints[name]))
            };
        }
        return processors;
    }

    convertField(field: Record<string, any>): string {
        if (Object.hasOwn(typeMap, field.type)) {
            const type = this.getConstraintProcessors(field).reduce((type, processor) => processor.processType(type), typeMap[field.type].getType(field));
            return `    ${field.name}: ${type};`;
        }
        throw new Error(`Unsupported field type: ${field.type} for field ${field.name}`);
    }
}

interface TypeBridgeI {
    toTypescript(field: Record<string, any>): string;
    getType(field: Record<string, any>): string;
}

class BasicTypeBridge implements TypeBridgeI {
    public toTypescript(field: Record<string, any>): string {
        return `    ${field.name}: ${field.type};`;
    }

    public getType(field: Record<string, any>): string {
        return field.type;
    }
}

class NumericTypeBridge extends BasicTypeBridge {
    public getType(_field: Record<string, any>): string {
        return "number";
    }
}


interface ConstraintProcessorI {
    processType(type: string): string;
}

class NullableConstraintProcessor implements ConstraintProcessorI {
    public constructor(private readonly value: any) {
        if (!([true, false].includes(value)))
            throw new Error(`Invalid value for nullable constraint: ${value}. Expected true or false.`);

		console.log("NullableConstraintProcessor created with value: ", value);
    }
    public processType(type: string): string {
        return this.value ? type + '?' : type;
    }
}

class PrimaryKeyConstraintProcessor implements ConstraintProcessorI {
    public constructor(private readonly _value: any) {
        if (!([true, false].includes(_value)))
            throw new Error(`Invalid value for primaryKey constraint: ${_value}. Expected true or false.`);
    }
    public processType(type: string): string {
        return type;
    }
}


const typeMap: Record<string, TypeBridgeI> = {
    "integer": new NumericTypeBridge(),
    "string": new BasicTypeBridge(),
    "boolean": new BasicTypeBridge()
}

