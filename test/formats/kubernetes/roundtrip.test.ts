import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generate } from "../../../src/formats/kubernetes/generate";
import { load } from "../../../src/formats/kubernetes/load";
import { makeModel } from "../../helpers/makeModel";

describe("kubernetes generate → load round-trip", () => {
  it("reproduces elements, kinds, technology, relations and namespace", async () => {
    const model = makeModel({
      elements: [
        {
          name: "orders-api",
          kind: "Container",
          technology: "Node.js",
          relations: [{ to: "orders-db" }, { to: "billing" }],
        },
        { name: "orders-db", kind: "ContainerDb", technology: "PostgreSQL" },
        { name: "billing", kind: "Container", technology: "Go" },
      ],
      boundaries: [
        {
          name: "shop",
          elementNames: ["orders-api", "orders-db", "billing"],
        },
      ],
    });

    const out = generate(model);
    const dir = await mkdtemp(join(tmpdir(), "aact-k8s-rt-"));
    for (const f of out.files) await writeFile(join(dir, f.path), f.content);

    const { model: loaded } = await load(dir);

    expect(Object.keys(loaded.elements).toSorted()).toEqual([
      "billing",
      "orders-api",
      "orders-db",
    ]);
    expect(loaded.elements["orders-db"].kind).toBe("ContainerDb");
    expect(loaded.elements["orders-api"].kind).toBe("Container");
    expect(loaded.elements["orders-api"].technology).toBe("Node.js");
    expect(loaded.elements["orders-db"].technology).toBe("PostgreSQL");
    // relations resolve through the generated Services (orders-db-svc, …)
    expect(
      loaded.elements["orders-api"].relations.map((r) => r.to).toSorted(),
    ).toEqual(["billing", "orders-db"]);
    // boundary round-trips through metadata.namespace
    expect(Object.keys(loaded.boundaries)).toEqual(["shop"]);
    expect(loaded.boundaries.shop.elementNames.toSorted()).toEqual([
      "billing",
      "orders-api",
      "orders-db",
    ]);
  });
});
