/*
 * Tests for Typescipy Bridge class
 */
import * as fs from 'node:fs';
import { TypescriptBridge } from './TypescriptBridge';
import { Model, Metadata, Field, Constraint } from './Model';

describe('TypescriptBridge', () => {
    let bridge: TypescriptBridge;

    beforeEach(() => {
        bridge = new TypescriptBridge();
    });

    it('should convert a simple model to TypeScript class', () => {
		// Load model from src/examples/user_core_model.json
		const modelData = fs.readFileSync('src/examples/user_core_model.json', 'utf-8');
        const model = new Model(JSON.parse(modelData));
        const tsClass = bridge.toTypescript(model);
        const expected = `class User {\n    id: number;\n    userName: string;\n    firstName: string;\n    secondName: string?;\n}`;
        expect(tsClass).toBe(expected);
    }
    );
    
}
);

