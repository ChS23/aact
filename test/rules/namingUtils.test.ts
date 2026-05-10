import type { ArchitectureModel } from "../../src/model";
import type { NamingConvention } from "../../src/rules/namingUtils";
import { detectNamingConvention, joinName } from "../../src/rules/namingUtils";

const makeModel = (names: string[]): ArchitectureModel => ({
  boundaries: [],
  allContainers: names.map((name) => ({
    name,
    label: name,
    type: "Container",
    description: "",
    relations: [],
  })),
});

describe("detectNamingConvention", () => {
  it("returns snake for empty model", () => {
    expect(detectNamingConvention(makeModel([]))).toBe("snake");
  });

  it("detects snake_case", () => {
    expect(
      detectNamingConvention(
        makeModel(["orders_api", "orders_db", "user_svc"]),
      ),
    ).toBe("snake");
  });

  it("detects camelCase", () => {
    expect(
      detectNamingConvention(makeModel(["ordersApi", "ordersDb", "userSvc"])),
    ).toBe("camel");
  });

  it("detects kebab-case", () => {
    expect(
      detectNamingConvention(
        makeModel(["orders-api", "orders-db", "user-svc"]),
      ),
    ).toBe("kebab");
  });

  it("falls back to snake when mixed", () => {
    expect(detectNamingConvention(makeModel(["orders_api", "ordersDb"]))).toBe(
      "snake",
    );
  });
});

describe("joinName", () => {
  const cases: [string, string, NamingConvention, string][] = [
    ["orders", "repo", "snake", "orders_repo"],
    ["orders", "repo", "camel", "ordersRepo"],
    ["orders", "repo", "kebab", "orders-repo"],
    ["orders", "acl", "snake", "orders_acl"],
    ["ordersApi", "acl", "camel", "ordersApiAcl"],
    ["orders-api", "acl", "kebab", "orders-api-acl"],
  ];

  it.each(cases)("joinName(%s, %s, %s) → %s", (base, word, conv, expected) => {
    expect(joinName(base, word, conv)).toBe(expected);
  });
});
