import {
  loadStructurizrElements,
  mapContainersFromStructurizr,
} from "../../src/loaders/structurizr";
import { ArchitectureModel } from "../../src/model";

describe("Structurizr Loader", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    model = await loadStructurizrElements(
      "resources/architecture/workspace.json",
    );
  });

  it("loads containers from workspace.json", () => {
    expect(model.allContainers.length).toBeGreaterThan(0);
  });

  it("identifies external systems", () => {
    const externalSystems = model.allContainers.filter(
      (c) => c.type === "System_Ext",
    );
    expect(externalSystems.length).toBeGreaterThan(0);
  });

  it("identifies databases", () => {
    const databases = model.allContainers.filter(
      (c) => c.type === "ContainerDb",
    );
    expect(databases.length).toBeGreaterThan(0);
  });

  it("loads boundaries", () => {
    expect(model.boundaries.length).toBeGreaterThan(0);
  });

  it("builds relations", () => {
    const relationsCount = model.allContainers.reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(relationsCount).toBeGreaterThan(0);
  });

  it("rejects with ENOENT for nonexistent file", async () => {
    await expect(loadStructurizrElements("nonexistent.json")).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe("mapContainersFromStructurizr (unit)", () => {
  it("returns empty model for empty workspace", () => {
    const result = mapContainersFromStructurizr({
      model: { softwareSystems: [], people: [] },
    } as never);

    expect(result.allContainers).toHaveLength(0);
    expect(result.boundaries).toHaveLength(0);
  });

  it("tags async relations with 'async'", () => {
    const workspace = {
      model: {
        softwareSystems: [
          {
            id: "sys_a",
            name: "System A",
            containers: [
              {
                id: "svc_a",
                name: "Service A",
                relationships: [
                  {
                    destinationId: "svc_b",
                    interactionStyle: "Asynchronous",
                  },
                ],
              },
              {
                id: "svc_b",
                name: "Service B",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    };

    const result = mapContainersFromStructurizr(workspace as never);
    const svcA = result.allContainers.find((c) => c.name === "svc_a");
    expect(svcA?.relations[0].tags).toContain("async");
  });

  it("detects external system by tags when location is not set", () => {
    const workspace = {
      model: {
        softwareSystems: [
          {
            id: "ext",
            name: "External",
            tags: "External",
            containers: [],
          },
        ],
        people: [],
      },
    };

    const result = mapContainersFromStructurizr(workspace as never);
    const ext = result.allContainers.find((c) => c.name === "ext");
    expect(ext?.type).toBe("System_Ext");
  });
});
