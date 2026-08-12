import pm from "picomatch";

/**
 * Naming-convention helpers for role detection.
 *
 * Rules historically identified container roles ("this is a repo",
 * "this is an ACL") through explicit tags only. Real-world C4
 * archives — especially legacy projects predating aact or
 * agent-generated diagrams — encode the same intent in **names**
 * (`user_repository`, `payment_adapter`, `*Gateway`). Adding
 * name-pattern detection lets rules pick up those implicit signals
 * without requiring an explicit tag pass.
 *
 * Patterns are picomatch globs with brace expansion:
 *
 *   "*_{repo,repository,storage,dao}"  → matches *_repo, *_repository, *_storage, *_dao
 *   "*{Repository,Storage,DAO}"        → PascalCase variants
 *   "user_repo"                        → exact match (case-insensitive)
 *
 * picomatch is the gold-standard glob matcher (used by Jest, Vitest,
 * Astro, fast-glob, chokidar — 5M+ projects). It handles edge cases
 * (escape, nested braces, empty alternatives) that a hand-rolled
 * implementation would miss. Already a transitive dep via vitest, so
 * promoting it to direct is near-zero cost.
 */

/**
 * Default name patterns for repository / data-access containers.
 * Conservative enough to avoid false positives on names like
 * `legacy_storage_proxy` while covering common conventions across
 * snake_case and PascalCase codebases.
 */
export const DEFAULT_REPO_NAME_PATTERNS: readonly string[] = Object.freeze([
  "*_{repo,repository,storage,dao,store}",
  "*{Repository,Storage,DAO,Store}",
]);

/**
 * Default name patterns for Anti-corruption Layer containers —
 * wrappers / adapters / clients around external systems.
 */
export const DEFAULT_ACL_NAME_PATTERNS: readonly string[] = Object.freeze([
  "*_{adapter,wrapper,client,connector,integration}",
  "*{Adapter,Wrapper,Client,Connector,Integration}",
]);

/**
 * Returns true if `name` matches any picomatch pattern in `patterns`.
 * Case-insensitive — C4 codebases routinely mix `snake_case` and
 * `PascalCase`. Compiled matchers are cached by picomatch itself, so
 * repeated checks on the same patterns are O(1) after the first hit.
 */
export const matchesAnyName = (
  name: string,
  patterns: readonly string[],
): boolean => patterns.some((p) => pm(p, { nocase: true })(name));
