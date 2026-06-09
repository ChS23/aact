import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadBaseline } from "../../../../src/cli/commands/diff/baseline";

const makeTempPuml = (content: string, name = "arch.puml"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-test-"));
  const file = path.join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
};

const cleanupParent = (filePath: string): void => {
  try {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // benign
  }
};

const SIMPLE_PUML = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Container(svc, "Service")
@enduml`;

describe("loadBaseline — file path inputs", () => {
  it("loads a .puml file and reports format='plantuml'", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
      expect(result.side.source).toBe(file);
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.sourceNotFound when file does not exist", async () => {
    await expect(
      loadBaseline({ arg: "/nonexistent/file.puml", sideLabel: "baseline" }),
    ).rejects.toMatchObject({ kind: "model.sourceNotFound" });
  });

  it("throws format.unknown when extension is not recognised", async () => {
    const file = makeTempPuml("dummy", "arch.txt");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "format.unknown" });
    } finally {
      cleanupParent(file);
    }
  });

  it("honours formatOverride when extension is ambiguous", async () => {
    const file = makeTempPuml(SIMPLE_PUML, "arch.txt");
    try {
      const result = await loadBaseline({
        arg: file,
        formatOverride: "plantuml",
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
    } finally {
      cleanupParent(file);
    }
  });

  it("treats absolute paths containing ':' as file paths, not git refs", async () => {
    const file = makeTempPuml(SIMPLE_PUML, "arch:win.puml");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("auto-detects structurizr for a file literally named workspace.json", async () => {
    const workspace = {
      model: {
        softwareSystems: [
          {
            id: "1",
            name: "Sys",
            properties: { "structurizr.dsl.identifier": "sys" },
            containers: [
              {
                id: "2",
                name: "Svc",
                properties: { "structurizr.dsl.identifier": "svc" },
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    };
    const file = makeTempPuml(JSON.stringify(workspace), "workspace.json");
    try {
      const result = await loadBaseline({ arg: file, sideLabel: "baseline" });
      // basename === "workspace.json" → structurizr (line 123 branch), not
      // model-json, even though the extension is `.json`.
      expect(result.side.format).toBe("structurizr");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws format.unknown for an invalid explicit format override", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      await expect(
        loadBaseline({
          arg: file,
          formatOverride: "bogus",
          sideLabel: "baseline",
        }),
      ).rejects.toMatchObject({ kind: "format.unknown" });
    } finally {
      cleanupParent(file);
    }
  });
});

describe("loadBaseline — model-json inputs", () => {
  it("accepts raw Model JSON", async () => {
    const rawModel = {
      elements: {
        svc: {
          name: "svc",
          label: "svc",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      },
      boundaries: {},
      rootBoundaryNames: [],
    };
    const file = makeTempPuml(JSON.stringify(rawModel), "snap.aact.json");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("model-json");
      expect(result.model.elements.svc.name).toBe("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("accepts CliEnvelope<ModelData> shape from `aact model --json`", async () => {
    const envelope = {
      schemaVersion: 1,
      command: "model",
      ok: true,
      exitCode: 0,
      data: {
        model: {
          elements: {
            svc: {
              name: "svc",
              label: "svc",
              kind: "Container",
              external: false,
              description: "",
              tags: [],
              relations: [],
            },
          },
          boundaries: {},
          rootBoundaryNames: [],
        },
        issues: [],
      },
      diagnostics: [],
      meta: {
        aactVersion: "3.0.0-test",
        durationMs: 1,
        configPath: null,
        source: null,
      },
    };
    const file = makeTempPuml(JSON.stringify(envelope), "envelope.aact.json");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.model.elements.svc.name).toBe("svc");
      expect(result.side.format).toBe("model-json");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError on malformed JSON", async () => {
    const file = makeTempPuml("not json {", "bad.aact.json");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError when JSON is neither Model nor envelope", async () => {
    const file = makeTempPuml(JSON.stringify({ foo: "bar" }), "bad.aact.json");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError when envelope.data.model is missing", async () => {
    const file = makeTempPuml(
      JSON.stringify({ data: { issues: [] } }),
      "bad.aact.json",
    );
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });
});

// The actual stdin *read* (readFileSync(0)) is exercised in
// baselineMocked.test.ts, which mocks node:fs so the runner's pipe-less
// fd 0 doesn't throw. Here we cover the format-hint guard, which fires
// BEFORE any read and therefore is safe under vitest.
describe("loadBaseline — stdin guard", () => {
  it("throws format.unknown when stdin has no explicit --<side>-format", async () => {
    await expect(
      loadBaseline({ arg: "-", sideLabel: "baseline" }),
    ).rejects.toMatchObject({ kind: "format.unknown" });
  });

  it("the stdin guard error names the side-specific format flag", async () => {
    const error = await loadBaseline({ arg: "-", sideLabel: "current" }).catch(
      (error_: unknown) => error_,
    );
    expect((error as { message: string }).message).toContain(
      "--current-format",
    );
  });
});

describe("loadBaseline — git ref input", () => {
  it("throws model.sourceNotFound for a bogus git ref", async () => {
    await expect(
      loadBaseline({
        arg: "definitely-no-such-ref-xyz:architecture.puml",
        sideLabel: "baseline",
      }),
    ).rejects.toMatchObject({ kind: "model.sourceNotFound" });
  });

  it("loads a real git ref via scratch file when the ref exists", async () => {
    // Init a temp git repo, commit a PUML, then resolve the ref. This
    // exercises the scratch-tmp file path that the unit tests can't
    // hit without a real git working tree.
    const { execSync } = await import("node:child_process");
    const repo = mkdtempSync(path.join(tmpdir(), "aact-baseline-git-"));
    try {
      execSync("git init -q", { cwd: repo });
      execSync("git config user.email 'test@x' && git config user.name 'T'", {
        cwd: repo,
        shell: "/bin/sh",
      });
      writeFileSync(path.join(repo, "arch.puml"), SIMPLE_PUML, "utf8");
      execSync("git add arch.puml && git commit -q -m init", {
        cwd: repo,
        shell: "/bin/sh",
      });
      const result = await loadBaseline({
        arg: "HEAD:arch.puml",
        sideLabel: "baseline",
        cwd: repo,
      });
      expect(result.side.format).toBe("plantuml");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("auto-detects structurizr from a .dsl git ref path", async () => {
    const { execSync } = await import("node:child_process");
    const repo = mkdtempSync(path.join(tmpdir(), "aact-baseline-git-dsl-"));
    try {
      execSync("git init -q", { cwd: repo });
      execSync("git config user.email 'test@x' && git config user.name 'T'", {
        cwd: repo,
        shell: "/bin/sh",
      });
      writeFileSync(
        path.join(repo, "workspace.dsl"),
        `workspace {
          model {
            user = person "User"
            api = softwareSystem "API"
            user -> api "uses"
          }
        }`,
        "utf8",
      );
      execSync("git add workspace.dsl && git commit -q -m init", {
        cwd: repo,
        shell: "/bin/sh",
      });
      const result = await loadBaseline({
        arg: "HEAD:workspace.dsl",
        sideLabel: "baseline",
        cwd: repo,
      });
      // .dsl extension → structurizr detection (detectFormatFromPath), and
      // the scratch file keeps the .dsl suffix (scratchExt git-ref branch).
      expect(result.side.format).toBe("structurizr");
      expect(Object.keys(result.model.elements)).toContain("api");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("falls back to formatHint suffix for an extensionless git-ref path", async () => {
    const { execSync } = await import("node:child_process");
    const repo = mkdtempSync(path.join(tmpdir(), "aact-baseline-git-noext-"));
    try {
      execSync("git init -q", { cwd: repo });
      execSync("git config user.email 'test@x' && git config user.name 'T'", {
        cwd: repo,
        shell: "/bin/sh",
      });
      // No extension on the committed file → detectFormatFromPath returns
      // undefined, formatOverride supplies the hint, and scratchExt falls
      // back to `.${formatHint}` because path.extname is empty.
      writeFileSync(path.join(repo, "Archfile"), SIMPLE_PUML, "utf8");
      execSync("git add Archfile && git commit -q -m init", {
        cwd: repo,
        shell: "/bin/sh",
      });
      const result = await loadBaseline({
        arg: "HEAD:Archfile",
        formatOverride: "plantuml",
        sideLabel: "baseline",
        cwd: repo,
      });
      expect(result.side.format).toBe("plantuml");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("loadBaseline — directory inputs (kubernetes auto-detect)", () => {
  it("infers kubernetes for a directory argument", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-k8s-"));
    try {
      writeFileSync(
        path.join(dir, "deploy.yaml"),
        "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: orders }\nspec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "utf8",
      );
      const result = await loadBaseline({ arg: dir, sideLabel: "baseline" });
      expect(result.side.format).toBe("kubernetes");
      expect(Object.keys(result.model.elements)).toEqual(["orders"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not collide with file detection — compose.yaml still wins over k8s", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-compose-"));
    try {
      const file = path.join(dir, "compose.yaml");
      writeFileSync(file, "services:\n  api:\n    image: nginx", "utf8");
      const result = await loadBaseline({ arg: file, sideLabel: "baseline" });
      expect(result.side.format).toBe("compose");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadBaseline — options pass-through", () => {
  it("forwards options to format.load (skip glob applied)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-opts-"));
    try {
      writeFileSync(
        path.join(dir, "manifests.yaml"),
        [
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata: { name: orders }",
          "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
          "---",
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata: { name: orders-canary }",
          "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        ].join("\n"),
        "utf8",
      );
      const result = await loadBaseline({
        arg: dir,
        sideLabel: "baseline",
        options: { skip: ["*-canary"] },
      });
      expect(Object.keys(result.model.elements)).toEqual(["orders"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("undefined options preserves loader defaults", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      const result = await loadBaseline({ arg: file, sideLabel: "baseline" });
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });
});
