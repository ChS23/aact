import type { NamingConvention } from "../../../src/rules/lib/namingUtils";
import {
  detectNamingConvention,
  joinName,
} from "../../../src/rules/lib/namingUtils";
import { makeModel } from "../../helpers/makeModel";

const modelOf = (names: string[]) =>
  makeModel({ elements: names.map((name) => ({ name })) });

describe("detectNamingConvention", () => {
  it("returns snake for empty model", () => {
    expect(detectNamingConvention(modelOf([]))).toBe("snake");
  });

  it("detects snake_case", () => {
    expect(
      detectNamingConvention(modelOf(["orders_api", "orders_db", "user_svc"])),
    ).toBe("snake");
  });

  it("detects camelCase", () => {
    expect(
      detectNamingConvention(modelOf(["ordersApi", "ordersDb", "userSvc"])),
    ).toBe("camel");
  });

  it("detects kebab-case", () => {
    expect(
      detectNamingConvention(modelOf(["orders-api", "orders-db", "user-svc"])),
    ).toBe("kebab");
  });

  it("falls back to snake when mixed", () => {
    expect(detectNamingConvention(modelOf(["orders_api", "ordersDb"]))).toBe(
      "snake",
    );
  });

  it("returns snake when hyphen ties with underscore (covers strict > vs >=)", () => {
    // Stryker mutated `withHyphen > withUnderscore` to `>=`. With >=,
    // a tied score (1=1) would return "kebab"; without, it falls through
    // to the camel check and finally snake.
    expect(detectNamingConvention(modelOf(["a-b", "c_d"]))).toBe("snake");
  });

  it("returns camel when camelCase dominates and hyphen is rare (covers && vs ||)", () => {
    // Stryker mutated `withHyphen > withUnderscore && withHyphen > withCamel`
    // to `||`. With ||, presence of a single hyphenated name (greater than
    // 0 underscores) would trigger "kebab" even though camel dominates.
    // Pin: 3 camel names + 1 hyphenated name + 0 underscores → camel.
    expect(
      detectNamingConvention(
        modelOf(["orderApi", "orderDb", "userSvc", "a-b"]),
      ),
    ).toBe("camel");
  });

  it("returns camel when hyphen ties with camel (covers strict > on camel)", () => {
    // Stryker mutated `withHyphen > withCamel` to `>=`. With >=, a tied
    // count (1 hyphen, 1 camel, 0 underscore) would return "kebab"; with
    // strict >, the kebab condition fails and camel wins.
    expect(detectNamingConvention(modelOf(["fooBar", "a-b"]))).toBe("camel");
  });

  it("returns snake when no naming style dominates (covers ConditionalExpression true)", () => {
    // Stryker mutated `if (...) return \"kebab\"` to `if (true)`. With true,
    // any non-empty input returns kebab. Pin: snake_case only → snake.
    expect(detectNamingConvention(modelOf(["orders_api", "user_svc"]))).toBe(
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
