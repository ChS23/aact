import {
  parseImage,
  technologyLabel,
} from "../../../src/formats/_shared/imageHeuristic";

describe("parseImage — bare image refs", () => {
  it("bare repo name", () => {
    const parsed = parseImage("postgres");
    expect(parsed.raw).toBe("postgres");
    expect(parsed.registry).toBe("");
    expect(parsed.repo).toBe("postgres");
    expect(parsed.baseName).toBe("postgres");
    expect(parsed.tag).toBe("");
    expect(parsed.digest).toBe("");
  });

  it("repo:tag", () => {
    const parsed = parseImage("postgres:13");
    expect(parsed.repo).toBe("postgres");
    expect(parsed.baseName).toBe("postgres");
    expect(parsed.tag).toBe("13");
    expect(parsed.digest).toBe("");
  });

  it("namespace/repo (no registry, single org)", () => {
    const parsed = parseImage("bitnami/postgresql");
    expect(parsed.registry).toBe("");
    expect(parsed.repo).toBe("bitnami/postgresql");
    expect(parsed.baseName).toBe("postgresql");
    expect(parsed.tag).toBe("");
  });

  it("namespace/repo:tag", () => {
    const parsed = parseImage("bitnami/postgresql:16");
    expect(parsed.registry).toBe("");
    expect(parsed.repo).toBe("bitnami/postgresql");
    expect(parsed.baseName).toBe("postgresql");
    expect(parsed.tag).toBe("16");
  });

  it("library/repo (Docker Hub official) keeps full repo path", () => {
    // Strip happens in `technologyLabel`, not in `parseImage`.
    const parsed = parseImage("library/postgres:13");
    expect(parsed.repo).toBe("library/postgres");
    expect(parsed.baseName).toBe("postgres");
    expect(parsed.tag).toBe("13");
    expect(parsed.registry).toBe("");
  });

  it("lowercases baseName", () => {
    const parsed = parseImage("PostgreSQL:13");
    expect(parsed.baseName).toBe("postgresql");
    // repo preserves original casing.
    expect(parsed.repo).toBe("PostgreSQL");
  });
});

describe("parseImage — registry-prefixed refs", () => {
  it("known registry host", () => {
    const parsed = parseImage("ghcr.io/org/api:v1.2");
    expect(parsed.registry).toBe("ghcr.io");
    expect(parsed.repo).toBe("org/api");
    expect(parsed.baseName).toBe("api");
    expect(parsed.tag).toBe("v1.2");
  });

  it("registry with port (localhost:5000)", () => {
    const parsed = parseImage("localhost:5000/myimg:dev");
    expect(parsed.registry).toBe("localhost:5000");
    expect(parsed.repo).toBe("myimg");
    expect(parsed.baseName).toBe("myimg");
    expect(parsed.tag).toBe("dev");
  });

  it("registry-only segment with no extra path", () => {
    // `gcr.io/myimg` — first segment is a known registry; repoPath
    // becomes empty (head sliced off).
    const parsed = parseImage("gcr.io/myimg");
    expect(parsed.registry).toBe("gcr.io");
    expect(parsed.repo).toBe("myimg");
    expect(parsed.baseName).toBe("myimg");
  });

  it("registry with digest only (no tag)", () => {
    const parsed = parseImage(
      "ghcr.io/org/api@sha256:abc123def4567890123456789012345678901234567890123456789012345678",
    );
    expect(parsed.registry).toBe("ghcr.io");
    expect(parsed.repo).toBe("org/api");
    expect(parsed.tag).toBe("");
    expect(parsed.digest).toMatch(/^sha256:/);
  });

  it("registry + repo + tag + digest", () => {
    const parsed = parseImage(
      "ghcr.io/org/api:v1.2@sha256:abc1234567890123456789012345678901234567890123456789012345678abc",
    );
    expect(parsed.registry).toBe("ghcr.io");
    expect(parsed.repo).toBe("org/api");
    expect(parsed.tag).toBe("v1.2");
    expect(parsed.digest).toContain("sha256:abc");
  });

  it("first segment containing dot but no known host (custom registry)", () => {
    const parsed = parseImage("my.registry.local/team/svc:1.0");
    expect(parsed.registry).toBe("my.registry.local");
    expect(parsed.repo).toBe("team/svc");
    expect(parsed.baseName).toBe("svc");
  });
});

describe("parseImage — env-var interpolation", () => {
  it("`${VAR:-default}` expands to default", () => {
    const parsed = parseImage("${POSTGRES_IMAGE:-postgres:13}");
    expect(parsed.repo).toBe("postgres");
    expect(parsed.tag).toBe("13");
  });

  it("`${VAR}` falls back to lowercased var name", () => {
    const parsed = parseImage("${POSTGRES_IMAGE}");
    expect(parsed.baseName).toBe("postgres_image");
  });

  it("plain string with no interp passes through untouched", () => {
    const parsed = parseImage("redis:7");
    expect(parsed.baseName).toBe("redis");
    expect(parsed.tag).toBe("7");
  });

  it("malformed env interp does not throw", () => {
    const parsed = parseImage("${broken");
    // Treated as literal string — first char `$` is non-alnum but
    // parseImage never throws.
    expect(parsed.raw).toBe("${broken");
  });
});

describe("parseImage — edge cases", () => {
  it("empty string", () => {
    const parsed = parseImage("");
    expect(parsed.raw).toBe("");
    expect(parsed.repo).toBe("");
    expect(parsed.baseName).toBe("");
    expect(parsed.tag).toBe("");
    expect(parsed.digest).toBe("");
  });

  it("freezes returned object", () => {
    expect(Object.isFrozen(parseImage("postgres"))).toBe(true);
  });
});

describe("technologyLabel", () => {
  it("registry + repo + tag → registry/repo:tag", () => {
    const parsed = parseImage("ghcr.io/org/api:v1");
    expect(technologyLabel(parsed)).toBe("ghcr.io/org/api:v1");
  });

  it("strips library/ prefix for Docker Hub official images", () => {
    const parsed = parseImage("library/postgres:13");
    expect(technologyLabel(parsed)).toBe("postgres:13");
  });

  it("strips digest", () => {
    const parsed = parseImage(
      "postgres:13@sha256:abc1234567890123456789012345678901234567890123456789012345678abc",
    );
    expect(technologyLabel(parsed)).toBe("postgres:13");
  });

  it("repo with no tag returns repo only", () => {
    const parsed = parseImage("postgres");
    expect(technologyLabel(parsed)).toBe("postgres");
  });

  it("empty parsed returns empty string", () => {
    expect(technologyLabel(parseImage(""))).toBe("");
  });

  it("registry without library-prefix stripping (registry stays, library does not)", () => {
    // `library/` only strips for non-registry case; with a registry,
    // the path stays verbatim.
    const parsed = parseImage("docker.io/library/postgres:13");
    expect(technologyLabel(parsed)).toBe("docker.io/library/postgres:13");
  });
});
