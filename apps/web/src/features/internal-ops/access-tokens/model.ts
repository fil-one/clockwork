import type {
  AccessTokenAdminRecord,
  AccessTokenRecord,
} from "@clockwork/contracts";

/** What the Settings page's Access tokens section shows. */
export type OwnAccessTokensView =
  | {
      mode: "live";
      tokens: AccessTokenRecord[];
      /** Verified MFA in this session in the last 30 minutes. */
      recentlyVerified: boolean;
    }
  | { mode: "demo" | "unavailable" };

/** Every staff member's tokens, for the Team page. */
export type StaffAccessTokensView =
  | { mode: "live"; tokens: AccessTokenAdminRecord[] }
  | { mode: "demo" | "unavailable" };

export type AccessTokenActionResult<T = null> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "RECENT_SIGN_IN_REQUIRED"
        | "DIRECT_SESSION_REQUIRED"
        | "NOT_PERMITTED"
        | "NOT_AVAILABLE"
        | "INVALID_INPUT"
        | "LIMIT_REACHED"
        | "NOT_FOUND"
        | "SESSION_EXPIRED"
        | "UNEXPECTED";
    };
