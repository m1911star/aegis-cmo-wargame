export type Check = (value: unknown, path: string) => void;

export function invalid(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const text: Check = (value, path) => {
  if (typeof value !== 'string') invalid(path, 'expected a string');
};

export const id: Check = (value, path) => {
  text(value, path);
  if (!(value as string).trim() || ['__proto__', 'constructor', 'prototype'].includes(value as string)) {
    invalid(path, 'expected a non-empty, non-reserved identifier');
  }
};

export const boolean: Check = (value, path) => {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean');
};

export function number(min = -Infinity, max = Infinity, integer = false): Check {
  return (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      invalid(path, `expected a finite ${integer ? 'integer' : 'number'} in [${min}, ${max}]`);
    }
  };
}

export function optional(check: Check): Check {
  return (value, path) => { if (value !== undefined) check(value, path); };
}

export function oneOf(values: readonly string[]): Check {
  return (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) invalid(path, `expected one of ${values.join(', ')}`);
  };
}

export function object(fields: Record<string, Check>): Check {
  return (value, path) => {
    if (!isRecord(value)) invalid(path, 'expected an object');
    for (const [field, check] of Object.entries(fields)) {
      check(Object.hasOwn(value, field) ? value[field] : undefined, `${path}.${field}`);
    }
  };
}

export function array(check: Check, minLength = 0): Check {
  return (value, path) => {
    if (!Array.isArray(value) || value.length < minLength) invalid(path, `expected an array with at least ${minLength} items`);
    value.forEach((item, index) => check(item, `${path}[${index}]`));
  };
}

export function record(check: Check): Check {
  return (value, path) => {
    if (!isRecord(value)) invalid(path, 'expected a dictionary');
    for (const [key, item] of Object.entries(value)) {
      id(key, `${path} key`);
      check(item, `${path}.${key}`);
    }
  };
}

export function taggedUnion(variants: Record<string, Check>): Check {
  return (value, path) => {
    if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(variants, value.type)) {
      invalid(path, 'unknown or missing type');
    }
    variants[value.type](value, path);
  };
}

export const coordinate: Check = (value, path) => {
  if (!Array.isArray(value) || value.length !== 2) invalid(path, 'expected [longitude, latitude]');
  number(-180, 180)(value[0], `${path}[0]`);
  number(-90, 90)(value[1], `${path}[1]`);
};
