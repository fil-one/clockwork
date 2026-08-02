import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { StateGallery } from "@/src/features/states/state-gallery";

describe("experience accessibility", () => {
  it("has no axe violations across designed application states", async () => {
    render(<StateGallery />);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });
});
