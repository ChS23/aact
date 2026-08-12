// Node 16.11+ ships a built-in equivalent of the `strip-ansi` package.
// Re-exported here so test files can `import { stripAnsi } from
// "../helpers/stripAnsi"` without committing to a 3rd-party dep.
//
// Vitest renders match `toContain` / `toMatch` against the literal output
// of CLI renderers. consola/picocolors auto-enable ANSI in environments
// that look like real terminals or CI (GITHUB_ACTIONS, FORCE_COLOR), so
// production code paths emit bold/dim escapes mid-token (e.g. the bold
// `Boundaries: ` label ending in `[22m` right before the number).
// Pinning NO_COLOR at the vitest layer would hide that the SUT can colour
// — instead, tests strip the escapes at the assertion boundary so the
// SUT keeps its production-style output and the assertions stay
// resilient to terminal-detection flakes.
export { stripVTControlCharacters as stripAnsi } from "node:util";
