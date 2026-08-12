import { resolveNamingTransform } from "../../../src/formats/compose/naming";

// Naming-transform preset tests: cover every preset value, the
// `{ transform }` escape-hatch, and the undefined-default fallback
// (everything `resolveNamingTransform` is meant to dispatch on).

describe("resolveNamingTransform — presets", () => {
  it("undefined → identity (as-is)", () => {
    // Required nullable param — explicit undefined hits the default branch.
    // eslint-disable-next-line unicorn/no-useless-undefined
    const fn = resolveNamingTransform(undefined);
    expect(fn("landing-app")).toBe("landing-app");
    expect(fn("LandingApp")).toBe("LandingApp");
    expect(fn("")).toBe("");
  });

  it('"as-is" → identity', () => {
    const fn = resolveNamingTransform("as-is");
    expect(fn("landing-app")).toBe("landing-app");
    expect(fn("foo")).toBe("foo");
  });

  it("kebab-to-camel converts kebab → camelCase", () => {
    const fn = resolveNamingTransform("kebab-to-camel");
    expect(fn("landing-app")).toBe("landingApp");
    expect(fn("api-gateway-svc")).toBe("apiGatewaySvc");
    expect(fn("single")).toBe("single");
    expect(fn("")).toBe("");
  });

  it("kebab-to-pascal converts kebab → PascalCase", () => {
    const fn = resolveNamingTransform("kebab-to-pascal");
    expect(fn("landing-app")).toBe("LandingApp");
    expect(fn("api-gateway-svc")).toBe("ApiGatewaySvc");
    expect(fn("solo")).toBe("Solo");
  });

  it("snake-to-camel converts snake → camelCase", () => {
    const fn = resolveNamingTransform("snake-to-camel");
    expect(fn("landing_app")).toBe("landingApp");
    expect(fn("api_gateway_svc")).toBe("apiGatewaySvc");
  });

  it("snake-to-pascal converts snake → PascalCase", () => {
    const fn = resolveNamingTransform("snake-to-pascal");
    expect(fn("landing_app")).toBe("LandingApp");
    expect(fn("api_gateway_svc")).toBe("ApiGatewaySvc");
  });

  it("to-kebab converts camel / pascal / snake → kebab-case", () => {
    const fn = resolveNamingTransform("to-kebab");
    expect(fn("landingApp")).toBe("landing-app");
    expect(fn("LandingApp")).toBe("landing-app");
    expect(fn("landing_app")).toBe("landing-app");
    expect(fn("APIGateway")).toBe("api-gateway");
  });

  it("to-snake converts camel / pascal / kebab → snake_case", () => {
    const fn = resolveNamingTransform("to-snake");
    expect(fn("landingApp")).toBe("landing_app");
    expect(fn("LandingApp")).toBe("landing_app");
    expect(fn("landing-app")).toBe("landing_app");
    expect(fn("APIGateway")).toBe("api_gateway");
  });

  it("preserves digits in word boundaries", () => {
    // Word splitter is `[a-z0-9]([A-Z])` — make sure digit→Upper
    // boundary triggers a split (e.g. `s3Bucket` → `s3 Bucket`).
    const camel = resolveNamingTransform("to-kebab");
    expect(camel("s3Bucket")).toBe("s3-bucket");
    expect(camel("api2Gateway")).toBe("api2-gateway");
  });

  it("unknown preset string falls back to as-is", () => {
    // Defensive: PRESETS[raw] ?? PRESETS["as-is"]. We can hit this
    // branch by casting an arbitrary string into the type. The
    // function returns identity, not throws.
    const fn = resolveNamingTransform("not-a-preset" as unknown as "as-is");
    expect(fn("anything")).toBe("anything");
  });

  it("{ transform } escape hatch wins over preset dispatch", () => {
    const fn = resolveNamingTransform({
      transform: (raw) => `__${raw}__`,
    });
    expect(fn("svc")).toBe("__svc__");
  });
});
