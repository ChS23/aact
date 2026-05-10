import { applyEdits } from "../../src/rules/fix";

describe("applyEdits", () => {
  const source = [
    'Container(svc_a, "Service A")',
    'Container(svc_b, "Service B")',
    'Rel(svc_a, svc_b, "")',
  ].join("\n");

  it("returns source unchanged for empty edits", () => {
    expect(applyEdits(source, [])).toBe(source);
  });

  it("removes a line matching search", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "Rel(svc_a, svc_b" },
    ]);
    expect(result).toBe(
      ['Container(svc_a, "Service A")', 'Container(svc_b, "Service B")'].join(
        "\n",
      ),
    );
  });

  it("replaces a line matching search", () => {
    const result = applyEdits(source, [
      {
        type: "replace",
        search: "Rel(svc_a, svc_b",
        content: 'Rel(svc_a, svc_c, "")',
      },
    ]);
    expect(result).toContain('Rel(svc_a, svc_c, "")');
    expect(result).not.toContain("Rel(svc_a, svc_b");
  });

  it("adds a line after the anchor", () => {
    const result = applyEdits(source, [
      {
        type: "add",
        search: 'Container(svc_a, "Service A")',
        content: 'Container(svc_a_acl, "Service A ACL")',
      },
    ]);
    const lines = result.split("\n");
    expect(lines[0]).toBe('Container(svc_a, "Service A")');
    expect(lines[1]).toBe('Container(svc_a_acl, "Service A ACL")');
    expect(lines[2]).toBe('Container(svc_b, "Service B")');
  });

  it("applies multiple edits sequentially", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "Rel(svc_a, svc_b" },
      {
        type: "add",
        search: 'Container(svc_b, "Service B")',
        content: 'Rel(svc_a, svc_c, "")',
      },
    ]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Rel(svc_a, svc_c, "")');
  });

  it("returns source unchanged when search not found", () => {
    const result = applyEdits(source, [
      { type: "remove", search: "NonExistentLine" },
    ]);
    expect(result).toBe(source);
  });
});
