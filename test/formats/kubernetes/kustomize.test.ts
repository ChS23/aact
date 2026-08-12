import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveKustomization } from "../../../src/formats/kubernetes/kustomize";

const make = (): Promise<string> => mkdtemp(join(tmpdir(), "aact-k8s-kustom-"));

describe("resolveKustomization — resources extraction", () => {
  it("resolves relative paths against kustomization.yaml directory", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(
      file,
      "resources:\n  - ./deploy.yaml\n  - ../base/svc.yaml",
    );
    const { resourcePaths, issues } = await resolveKustomization(file);
    expect(resourcePaths).toEqual([
      join(dir, "deploy.yaml"),
      join(dir, "..", "base", "svc.yaml"),
    ]);
    expect(issues).toEqual([]);
  });

  it("returns empty list when resources field absent", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(file, "namespace: shop");
    const { resourcePaths } = await resolveKustomization(file);
    expect(resourcePaths).toEqual([]);
  });

  it("flags advanced features with single combined issue", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(
      file,
      [
        "resources:",
        "  - deploy.yaml",
        "patches:",
        "  - target:",
        "      kind: Deployment",
        "    patch: |",
        "      - op: replace",
        "namePrefix: prod-",
        "commonLabels:",
        "  env: prod",
      ].join("\n"),
    );
    const { resourcePaths, issues } = await resolveKustomization(file);
    expect(resourcePaths).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "loader-warning",
      source: "kubernetes",
      code: "kustomize-advanced-unsupported",
    });
    expect(issues[0].kind === "loader-warning" && issues[0].message).toMatch(
      /patches/,
    );
  });

  it("warns + skips remote resources", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(
      file,
      [
        "resources:",
        "  - https://example.com/manifest.yaml",
        "  - github.com/org/repo/path",
        "  - ./local.yaml",
      ].join("\n"),
    );
    const { resourcePaths, issues } = await resolveKustomization(file);
    expect(resourcePaths).toHaveLength(1);
    expect(resourcePaths[0]).toContain("local.yaml");
    expect(
      issues.filter(
        (i) =>
          i.kind === "loader-warning" &&
          i.code === "kustomize-remote-unsupported",
      ),
    ).toHaveLength(2);
  });

  it.each([
    "git@github.com:org/repo.git",
    "ssh://git@gitlab.com/team/manifests",
  ])("warns + skips git/ssh remote ref %s", async (ref) => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(file, `resources:\n  - ${ref}`);
    const { resourcePaths, issues } = await resolveKustomization(file);
    expect(resourcePaths).toEqual([]);
    expect(
      issues.some(
        (i) =>
          i.kind === "loader-warning" &&
          i.code === "kustomize-remote-unsupported",
      ),
    ).toBe(true);
  });

  it("ignores non-string entries in resources array", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    // resources mixed with map-form (kustomize allows component refs)
    await writeFile(
      file,
      ["resources:", "  - ./local.yaml", "  - {url: bad}"].join("\n"),
    );
    const { resourcePaths } = await resolveKustomization(file);
    expect(resourcePaths).toHaveLength(1);
  });

  it("returns empty when kustomization.yaml content is malformed (not an object)", async () => {
    const dir = await make();
    const file = join(dir, "kustomization.yaml");
    await writeFile(file, "not-a-map");
    const { resourcePaths, issues } = await resolveKustomization(file);
    expect(resourcePaths).toEqual([]);
    expect(issues).toEqual([]);
  });
});
