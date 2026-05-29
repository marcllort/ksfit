import { describe, it, expect } from "vitest";
import { toCsv } from "../csv";

describe("toCsv", () => {
  it("emits a header row and data rows, CRLF-terminated", () => {
    const out = toCsv(["a", "b"], [[1, 2], [3, 4]]);
    expect(out).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("quotes cells containing comma, quote, or newline (RFC-4180)", () => {
    const out = toCsv(["x"], [["a,b"], ['he said "hi"'], ["line1\nline2"]]);
    expect(out).toContain('"a,b"');
    expect(out).toContain('"he said ""hi"""');
    expect(out).toContain('"line1\nline2"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, ""]])).toBe("a,b,c\r\n,,\r\n");
  });
});
