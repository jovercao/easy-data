import { ProxyData, SYMBOLE_WATCHER } from "."

export type Binary = ArrayBuffer | SharedArrayBuffer
export type BaseType = string | Date | boolean | number | bigint | null | undefined | Binary | symbol

export function isBinary(value: any): value is Binary {
    return value instanceof ArrayBuffer ||
        value instanceof Uint8Array ||
        value instanceof Uint16Array ||
        value instanceof Uint32Array ||
        value instanceof BigUint64Array ||
        value instanceof Int8Array ||
        value instanceof Int16Array ||
        value instanceof Int32Array ||
        value instanceof BigInt64Array ||
        value instanceof Float32Array ||
        value instanceof Float64Array ||
        value instanceof Uint8ClampedArray ||
        value instanceof SharedArrayBuffer
}

export function isBaseType(value: any): value is BaseType {
    return value === undefined
        || value === null
        || value instanceof Date
        || isBinary(value)
        || typeof value === 'number'
        || typeof value === 'string'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
        || typeof value === 'symbol'
        || typeof value === 'function'
}

export function isUnspportedType(value: any): boolean {
    return !value || value instanceof Map || value instanceof Set
}

export function isProxyData(value: any): value is ProxyData<any> {
    return !!Reflect.get(value, SYMBOLE_WATCHER)
}

// export function isObjectOrObjectArray(value: any): value is object | object[] {
//     return (Array.isArray(value) && typeof [value]) typeof value === 'object'
// }
