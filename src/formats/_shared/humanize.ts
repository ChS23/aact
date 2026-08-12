/**
 * `orders-db` → `Orders DB`. Replace `-`/`_` separators with spaces and
 * title-case each word, but keep well-known acronyms fully uppercase so
 * labels synthesised from machine names read like human-authored titles
 * (`Orders API`, not `Orders Api`).
 *
 * Used by loaders that derive a label from a DNS / service name
 * (kubernetes, compose) and by the matching generators — both sides must
 * call the same function so round-trips stay stable (a generator emits an
 * explicit `aact.label` only when the label differs from `humanizeName`).
 */
const ACRONYMS: ReadonlySet<string> = new Set([
  "api",
  "db",
  "id",
  "url",
  "uri",
  "http",
  "https",
  "sql",
  "grpc",
  "dns",
  "tcp",
  "udp",
  "io",
  "ui",
  "cpu",
  "gpu",
  "ssl",
  "tls",
  "jwt",
  "sdk",
  "cli",
  "cdn",
  "acl",
  "ip",
]);

export const humanizeName = (raw: string): string =>
  raw
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .split(" ")
    .map((word) =>
      ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word,
    )
    .join(" ");
