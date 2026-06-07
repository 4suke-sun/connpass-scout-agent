import { describe, expect, it } from "vitest";
import { getFrameworkInfo, VERSION } from "./index.js";

describe("getFrameworkInfo", () => {
  it("バージョンが定義されている_正しいバージョン文字列を返す", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("フレームワーク情報が取得できる_名前とバージョンを含むオブジェクトを返す", () => {
    const info = getFrameworkInfo();
    expect(info.name).toBe("ai-auto-dev-framework");
    expect(info.version).toBe("0.1.0");
  });
});
