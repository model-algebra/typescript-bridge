import type { ModelBridge, Model } from "model-algebra-common";
export interface TypescriptBridgeOptions {
    /** Generate a class implementing the interface, with a validate() method (default: true). */
    class?: boolean;
    /** Generate a factory that builds an object incrementally from a Partial of the interface (default: true). */
    factory?: boolean;
    /** Appended to the model name to name the class (default: "Entity"). */
    classSuffix?: string;
    /** Appended to the model name to name the factory (default: "Factory"). */
    factorySuffix?: string;
    /**
     * How dates and times are typed: as Date objects (default), or as the ISO 8601 strings JSON carries, e.g.
     * "2026-11-01" for DATE, "13:45:00" for TIME, "2026-11-01T13:45:00Z" for TIMESTAMP_TZ.
     */
    dates?: 'Date' | 'string';
}
/**
 * Generates TypeScript source from a model: an interface, and optionally a class with a validate() method
 * and a factory that collects field values before building the object.
 */
export declare class TypescriptBridge implements ModelBridge<Model, string> {
    private readonly options;
    constructor(options?: TypescriptBridgeOptions);
    toTarget(model: Model): string;
    toModel(_typescript: string): Model;
    private fieldInfo;
    private tsType;
    private enumValues;
    private interfaceCode;
    private classCode;
    private fieldChecks;
    private violations;
    /** Values allowed by the enum constraint, or by the ENUM type of the field or of the items of an ARRAY field. */
    private allowedValues;
    /** Checks for model-level check constraints; primaryKey and unique need other objects and are not checked. */
    private ruleChecks;
    private ruleViolation;
    /**
     * Comparable value of a date: milliseconds since the epoch; with string dates, a TIME stays a string ("13:45:00"
     * compares in order). A literal of a rule is always a string.
     */
    private dateValue;
    /** Condition true when a date value is not a valid date. */
    private invalidDate;
    private ruleField;
    private ruleText;
    private factoryCode;
}
