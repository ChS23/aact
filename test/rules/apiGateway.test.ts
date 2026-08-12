import { apiGatewayRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("apiGatewayRule.check", () => {
  it("returns no violations when ACL routes through gateway", () => {
    const model = makeModel({
      elements: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "HTTPS via API Gateway" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("violates when ACL bypasses gateway", () => {
    const model = makeModel({
      elements: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "raw HTTP" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    const v = apiGatewayRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/gateway/i);
  });

  it("non-ACL containers are not checked", () => {
    const model = makeModel({
      elements: [
        { name: "svc", relations: [{ to: "ext", technology: "raw" }] },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("non-external targets are not checked", () => {
    const model = makeModel({
      elements: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "internal", technology: "raw" }],
        },
        { name: "internal" },
      ],
    });
    expect(apiGatewayRule.check(model)).toHaveLength(0);
  });

  it("anchors violation on the offending edge's sourceLocation", () => {
    const edgeLoc = {
      file: "arch.dsl",
      start: { line: 17, col: 3, offset: 250 },
      end: { line: 17, col: 40, offset: 287 },
    };
    const model = makeModel({
      elements: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [
            { to: "ext", technology: "raw HTTP", sourceLocation: edgeLoc },
          ],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    const [v] = apiGatewayRule.check(model);
    expect(v.sourceLocation).toEqual(edgeLoc);
  });

  it("respects custom gatewayPattern", () => {
    const model = makeModel({
      elements: [
        {
          name: "acl",
          tags: ["acl"],
          relations: [{ to: "ext", technology: "via custom-proxy" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(
      apiGatewayRule.check(model, { gatewayPattern: /custom-proxy/i }),
    ).toHaveLength(0);
  });
});
