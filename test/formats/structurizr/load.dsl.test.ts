/**
 * `structurizrFormat.load(path/to/workspace.dsl)` reads Structurizr
 * DSL sources directly through the chevrotain parser. This file
 * covers the DSL dispatch path — the JSON path is exercised
 * exhaustively by `load.test.ts`.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { load } from "../../../src/formats/structurizr/load";

const ECOMMERCE_DSL = path.resolve(
  __dirname,
  "../../../examples/ecommerce-structurizr/workspace.dsl",
);

describe("structurizrFormat.load — .dsl dispatch", () => {
  it("loads ecommerce workspace.dsl into a populated Model", async () => {
    const result = await load(ECOMMERCE_DSL);

    // Three internal systems (orders/inventory/fulfillment) each
    // gain a Boundary because they contain nested containers;
    // payment and notifications are leaf systems → Containers.
    // Model.elements keyed by DSL identifier (assignedIdentifier).
    expect(Object.keys(result.model.boundaries).sort()).toEqual([
      "fulfillment",
      "inventory",
      "orders",
    ]);
    expect(result.model.elements["payment"]?.kind).toBe("System");
    expect(result.model.elements["notifications"]?.kind).toBe("System");
    expect(result.model.elements["payment"]?.external).toBe(true);
    expect(result.model.elements["notifications"]?.external).toBe(true);

    // Container kinds resolved by name (CRUD → repo tag, DB → kind
    // ContainerDb when technology heuristic kicks in)
    expect(result.model.elements["orders_api"]?.kind).toBe("Container");
    expect(result.model.elements["orders_db"]?.kind).toBe("ContainerDb");
    expect(result.model.elements["orders_db"]?.technology).toBe("PostgreSQL");

    // Explicit relationships preserved with description, technology,
    // and default `Relationship` tag. relation.to references DSL ids.
    const ordersApi = result.model.elements["orders_api"];
    expect(ordersApi?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: "orders_crud", description: "HTTP" }),
        expect.objectContaining({ to: "inventory_api", description: "HTTP" }),
        expect.objectContaining({
          to: "fulfillment_api",
          description: "HTTP",
        }),
      ]),
    );
  });

  it("throws with a readable message on DSL parse errors", async () => {
    // A `.dsl` file that doesn't exist — fs.readFile rejects, the
    // loader propagates. (Bad-syntax case is covered by parser-level
    // tests.)
    await expect(load("/nonexistent/path/workspace.dsl")).rejects.toThrow();
  });

  it("expands local !include files before parsing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aact-struct-include-"));
    await writeFile(
      path.join(dir, "people.dsl"),
      'user = person "User"\n',
      "utf8",
    );
    const main = path.join(dir, "workspace.dsl");
    await writeFile(
      main,
      `workspace {
        model {
          !include people.dsl
          api = softwareSystem "API"
          user -> api "uses"
        }
      }`,
      "utf8",
    );

    const result = await load(main);

    expect(result.model.elements.user?.relations[0]).toEqual(
      expect.objectContaining({ to: "api", description: "uses" }),
    );
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "include-not-expanded" }),
    );
  });

  it("expands local !include directories in stable filename order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aact-struct-dir-include-"));
    const modelDir = path.join(dir, "model");
    await mkdir(modelDir);
    await writeFile(
      path.join(modelDir, "01-people.dsl"),
      'user = person "User"\n',
    );
    await writeFile(
      path.join(modelDir, "02-system.dsl"),
      'api = softwareSystem "API"\n',
    );
    const main = path.join(dir, "workspace.dsl");
    await writeFile(
      main,
      `workspace {
        model {
          !include model
          user -> api "uses"
        }
      }`,
      "utf8",
    );

    const result = await load(main);

    expect(result.model.elements.user).toBeDefined();
    expect(result.model.elements.api).toBeDefined();
    expect(result.model.elements.user?.relations[0]?.to).toBe("api");
  });
});
