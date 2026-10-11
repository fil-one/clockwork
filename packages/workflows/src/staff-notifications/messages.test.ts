import { describe, expect, it } from "vitest";

import { staffNotificationKindList } from "@clockwork/contracts";

import {
  notificationEmail,
  notificationLine,
  notificationSlackText,
} from "./messages";

describe("staff notification wording", () => {
  it("words every kind without an em dash", () => {
    for (const kind of staffNotificationKindList) {
      const line = notificationLine({
        kind,
        subject: "Acme",
        actorName: "Pat",
      });
      expect(line).toContain("Acme");
      expect(line).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it("puts the note and links in email, escaped in HTML", () => {
    const message = notificationEmail(
      {
        kind: "contract.sent_back",
        subject: "Acme <script>",
        actorName: "Lee",
        detail: "Use the 2026 DPA & MSA",
        href: "/internal/contracts/c1",
      },
      "https://commerce.fil.one",
    );
    expect(message.subject).toBe(
      "[Commerce] Lee sent the contract with Acme <script> back.",
    );
    expect(message.text).toContain("Note: Use the 2026 DPA & MSA");
    expect(message.text).toContain(
      "https://commerce.fil.one/internal/contracts/c1",
    );
    expect(message.text).toContain(
      "https://commerce.fil.one/internal/notifications",
    );
    expect(message.html).toContain("Acme &lt;script&gt;");
    expect(message.html).toContain("DPA &amp; MSA");
    expect(message.html).not.toContain("<script>");
  });

  it("keeps Slack to the record type, status, name and link", () => {
    const text = notificationSlackText(
      {
        kind: "contract.executed",
        subject: "Acme <Ltd> & Sons",
        href: "/internal/contracts/c1",
      },
      "https://commerce.fil.one",
    );
    expect(text).toBe(
      "*Contract executed*: <https://commerce.fil.one/internal/contracts/c1|Acme &lt;Ltd&gt; &amp; Sons>",
    );
  });

  it("omits links without a public origin", () => {
    expect(
      notificationSlackText(
        { kind: "mnda.completed", subject: "Acme", href: "/internal/mndas" },
        null,
      ),
    ).toBe("*MNDA fully signed*: Acme");
    expect(
      notificationEmail(
        {
          kind: "mnda.completed",
          subject: "Acme",
          actorName: null,
          detail: null,
          href: "/internal/mndas",
        },
        null,
      ).text,
    ).not.toContain("http");
  });
});
