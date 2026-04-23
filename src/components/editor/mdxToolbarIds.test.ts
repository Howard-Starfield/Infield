import { describe, expect, it } from "vitest";
import {
  DEFAULT_MDX_TOOL_ORDER,
  MDX_TOOL_IDS,
  normalizeMdxToolOrder,
} from "./mdxToolbarIds";

describe("normalizeMdxToolOrder", () => {
  it("accepts a valid permutation", () => {
    const rotated = [
      ...DEFAULT_MDX_TOOL_ORDER.slice(1),
      DEFAULT_MDX_TOOL_ORDER[0]!,
    ];
    expect(normalizeMdxToolOrder({ order: rotated })).toEqual(rotated);
  });

  it("rejects duplicates", () => {
    const bad = [...DEFAULT_MDX_TOOL_ORDER];
    bad[1] = bad[0]!;
    expect(normalizeMdxToolOrder({ order: bad })).toEqual(
      DEFAULT_MDX_TOOL_ORDER,
    );
  });

  it("rejects missing ids", () => {
    const bad = DEFAULT_MDX_TOOL_ORDER.slice(0, -1);
    expect(normalizeMdxToolOrder({ order: bad })).toEqual(
      DEFAULT_MDX_TOOL_ORDER,
    );
  });

  it("rejects invalid payload", () => {
    expect(normalizeMdxToolOrder(null)).toEqual(DEFAULT_MDX_TOOL_ORDER);
    expect(normalizeMdxToolOrder({ order: ["nope"] })).toEqual(
      DEFAULT_MDX_TOOL_ORDER,
    );
  });

  it("registry size matches default", () => {
    expect(MDX_TOOL_IDS.length).toBe(DEFAULT_MDX_TOOL_ORDER.length);
  });
});
