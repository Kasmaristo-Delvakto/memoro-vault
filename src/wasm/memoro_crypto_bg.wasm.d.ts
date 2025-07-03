/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const sha256_hash: (a: number, b: number) => [number, number];
export const derive_key: (a: number, b: number, c: number, d: number, e: number) => [number, number];
export const aes_gcm_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const aes_gcm_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const __wbindgen_export_0: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
