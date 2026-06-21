// GitHub blob URL for a rule's ADR. Anchored on `main` so the link
// survives rule renames and keeps resolving from an npm-installed build
// (where the local `ADRs/` directory isn't shipped). Each path segment is
// URL-encoded individually so spaces survive
// (`Anti-corruption Layer.md` → `Anti-corruption%20Layer.md`).
//
// One definition so the rule "passport" (`helpUri`) is identical across
// `check --json`'s `rules[]`, `rule list` / `rule explain`, and SARIF.
const ADR_BASE_URL = "https://github.com/Byndyusoft/aact/blob/main/";

export const adrHelpUri = (adrPath: string): string =>
  ADR_BASE_URL + adrPath.split("/").map(encodeURIComponent).join("/");
