import { describe, expect, it } from "vitest";
import { SPRING } from "./motion";

const ratio = ({ stiffness, damping, mass }: { stiffness: number; damping: number; mass: number }) =>
  damping / (2 * Math.sqrt(stiffness * mass));

describe("SPRING", () => {
  it("never overshoots a sheet past the screen edge", () => {
    expect(ratio(SPRING.sheet)).toBeGreaterThanOrEqual(1);
  });

  it("keeps every preset short of cartoonish", () => {
    for (const preset of Object.values(SPRING)) expect(ratio(preset)).toBeGreaterThan(0.5);
  });

  it("gives pop the most bounce, so arrivals read as arrivals", () => {
    const others = Object.entries(SPRING).filter(([name]) => name !== "pop");
    for (const [, preset] of others) expect(ratio(SPRING.pop)).toBeLessThan(ratio(preset));
  });
});
