/**
 * Technical (not just documentation-based) enforcement that a module never
 * ends up in a browser bundle. The ecosystem-standard `server-only` package
 * was evaluated and rejected: its conditional exports only no-op under
 * Next.js's own webpack build via the `"react-server"` condition — under
 * plain Node or Vitest it unconditionally throws on import, which would
 * break every unit test that imports a provider module with mocked `fetch`.
 * This guard gives the same "throws if it ever runs in a browser" property
 * while staying importable and testable under Node/Vitest, since `window` is
 * simply absent there rather than triggering a special-cased throw.
 *
 * Call this at module scope (not inside a function) in every file that holds
 * a provider API key, immediately after the imports.
 */
export function assertServerOnly(moduleName: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${moduleName} is server-only and must never be imported into a browser bundle.`);
  }
}
