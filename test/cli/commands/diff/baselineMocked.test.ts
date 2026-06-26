import * as realFs from "node:fs";

import { DiffInputError, loadBaseline } from "../../../../src/diff/baseline";
import { loadFormat } from "../../../../src/formats/registry";

// `readStdin` calls `readFileSync(0, "utf8")`, which throws under vitest's
// pipe-less worker (fd 0 is not a readable pipe). We intercept fd 0 only and
// delegate every other call to the real implementation so the scratch-file
// machinery (mkdtempSync / writeFileSync / rmSync) keeps working. This is the
// one path that exercises readStdin + the `arg === "-"` scratchExt branch +
// the `case "stdin"` switch arm — all unreachable from a real test runner.
let stdinContent = "";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof realFs>("node:fs");
  return {
    ...actual,
    readFileSync: ((fd: unknown, ...rest: unknown[]) => {
      if (fd === 0) return stdinContent;
      return (actual.readFileSync as (...a: unknown[]) => unknown)(fd, ...rest);
    }) as typeof realFs.readFileSync,
  };
});

const SIMPLE_PUML = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Container(svc, "Service")
@enduml`;

const RAW_MODEL_JSON = JSON.stringify({
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
});

describe("loadBaseline — stdin read (node:fs mocked)", () => {
  it("reads plantuml from stdin and materialises a .plantuml scratch file", async () => {
    stdinContent = SIMPLE_PUML;
    const result = await loadBaseline({
      arg: "-",
      formatOverride: "plantuml",
      sideLabel: "baseline",
    });
    expect(result.side.format).toBe("plantuml");
    expect(result.side.source).toBe("<stdin:baseline>");
    expect(Object.keys(result.model.elements)).toContain("svc");
  });

  it("uses the .aact.json scratch suffix for model-json stdin", async () => {
    stdinContent = RAW_MODEL_JSON;
    const result = await loadBaseline({
      arg: "-",
      formatOverride: "model-json",
      sideLabel: "current",
    });
    expect(result.side.format).toBe("model-json");
    expect(result.side.source).toBe("<stdin:current>");
    expect(result.model.elements.svc.name).toBe("svc");
  });
});

vi.mock("../../../../src/formats/registry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/formats/registry")
  >("../../../../src/formats/registry");
  return {
    ...actual,
    loadFormat: vi.fn(actual.loadFormat),
  };
});

const mockedLoadFormat = vi.mocked(loadFormat);

describe("loadBaseline — format without load capability", () => {
  it("throws model.unsupportedLoad when the resolved format cannot load", async () => {
    // A format object with no `load` — canLoad() returns false, hitting the
    // `model.unsupportedLoad` guard that real registered formats never trip.
    mockedLoadFormat.mockResolvedValueOnce({
      name: "plantuml",
    });

    stdinContent = SIMPLE_PUML;
    await expect(
      loadBaseline({
        arg: "-",
        formatOverride: "plantuml",
        sideLabel: "baseline",
      }),
    ).rejects.toMatchObject({ kind: "model.unsupportedLoad" });
  });

  it("re-throws a DiffInputError from format.load verbatim (no parseError wrap)", async () => {
    // When the loader itself throws a DiffInputError, loadBaseline must surface
    // it unchanged rather than re-wrapping it as model.parseError.
    const sourceError = new DiffInputError("model.parseError", "dangling ref", {
      from: "a",
    });
    mockedLoadFormat.mockResolvedValueOnce({
      name: "plantuml",
      load: () => Promise.reject(sourceError),
    });

    stdinContent = SIMPLE_PUML;
    const error = await loadBaseline({
      arg: "-",
      formatOverride: "plantuml",
      sideLabel: "baseline",
    }).catch((error_: unknown) => error_);
    expect(error).toBe(sourceError);
  });

  it("wraps a non-ToolError from format.load as model.parseError", async () => {
    mockedLoadFormat.mockResolvedValueOnce({
      name: "plantuml",
      load: () => Promise.reject(new Error("loader exploded")),
    });

    stdinContent = SIMPLE_PUML;
    const error = await loadBaseline({
      arg: "-",
      formatOverride: "plantuml",
      sideLabel: "baseline",
    }).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(DiffInputError);
    expect((error as DiffInputError).kind).toBe("model.parseError");
    expect((error as DiffInputError).message).toContain("loader exploded");
  });
});
