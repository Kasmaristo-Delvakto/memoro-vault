/* tslint:disable */
/* eslint-disable */
export function sha256_hash(input: Uint8Array): Uint8Array;
export function aes_gcm_encrypt(key_bytes: Uint8Array, nonce_bytes: Uint8Array, plaintext: Uint8Array): Uint8Array;
export function aes_gcm_decrypt(key_bytes: Uint8Array, nonce_bytes: Uint8Array, ciphertext: Uint8Array): Uint8Array;
/**
 * Argon2id key derivation (Rust/WASM, no JS dependency)
 */
export function argon2_derive(password: Uint8Array, salt: Uint8Array, time_cost: number, mem_kib: number, parallelism: number, hash_len: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly sha256_hash: (a: number, b: number) => [number, number];
  readonly aes_gcm_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly aes_gcm_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly argon2_derive: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
