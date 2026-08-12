import { describe, expect, it } from "vitest";

import { humanizeName } from "../../../src/formats/_shared/humanize";

describe("humanizeName", () => {
  it("title-cases dash/underscore separated names", () => {
    expect(humanizeName("orders-service")).toBe("Orders Service");
    expect(humanizeName("orders_service")).toBe("Orders Service");
    expect(humanizeName("orders")).toBe("Orders");
  });

  it("keeps well-known acronyms uppercase", () => {
    expect(humanizeName("orders-api")).toBe("Orders API");
    expect(humanizeName("orders-db")).toBe("Orders DB");
    expect(humanizeName("api-gateway")).toBe("API Gateway");
    expect(humanizeName("user-id-service")).toBe("User ID Service");
    expect(humanizeName("http-proxy")).toBe("HTTP Proxy");
  });

  it("is case-insensitive when matching acronyms", () => {
    expect(humanizeName("orders-DB")).toBe("Orders DB");
    expect(humanizeName("Orders-Api")).toBe("Orders API");
  });

  it("collapses repeated separators and trims", () => {
    expect(humanizeName("orders--api")).toBe("Orders API");
    expect(humanizeName("-orders-db-")).toBe("Orders DB");
  });

  it("returns empty string for empty input", () => {
    expect(humanizeName("")).toBe("");
  });

  it("leaves non-acronym words title-cased only", () => {
    // "apis" is not the acronym "api" — must not be uppercased wholesale.
    expect(humanizeName("public-apis")).toBe("Public Apis");
  });
});
