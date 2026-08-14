import { describe, expect, it } from "vitest";

import * as identity from "./identity";

describe("assisted-session authorization surface", () => {
  it("publishes exactly one identity repository entry point", () => {
    // A second assisted-session path is the finding, not a convenience. The
    // live reader (`resolveProviderAssistedSession`) additionally requires an
    // immutable `security.assisted_action.started` audit event, so any weaker
    // reader or any writer into `impersonation_sessions` re-exported from
    // `@clockwork/db` is a privileged surface a future caller can pick up
    // instead of the one that demands evidence.
    expect(Object.keys(identity).toSorted()).toEqual(["resolveWorkosIdentity"]);
    expect(identity).not.toHaveProperty("resolveActiveImpersonation");
    expect(identity).not.toHaveProperty("createAssistedActionSession");
  });
});
