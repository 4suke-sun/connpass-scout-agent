import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("PACKAGE_NAME", () => {
  it("パッケージ識別子が定義されている_package.jsonのnameと一致する", () => {
    expect(PACKAGE_NAME).toBe("@connpass-scout-agent/infra");
  });
});
