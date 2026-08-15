import { describe, it, expect } from "vitest";
import { isAllowed } from "./guards";

describe("isAllowed", () => {
  it("accepts a login on the list, case-insensitively", () => {
    expect(isAllowed("PLDagenais", "pldagenais")).toBe(true);
  });

  it("accepts a login from a multi-entry list", () => {
    expect(isAllowed("someone", "pldagenais, someone")).toBe(true);
  });

  it("rejects a login that is not listed", () => {
    expect(isAllowed("someone-else", "pldagenais")).toBe(false);
  });

  it("fails closed when the list is empty", () => {
    expect(isAllowed("pldagenais", "")).toBe(false);
  });

  it("fails closed for an empty login", () => {
    expect(isAllowed("", "pldagenais")).toBe(false);
  });
});
