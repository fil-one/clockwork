"use client";

import { useState, useTransition } from "react";

import { Button, StateBanner } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { acceptInvite } from "./actions";
import { inviteMessage } from "./model";

/** The accept button; a refusal is worded in place. */
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations();
  const [code, setCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="registration-form">
      {code ? (
        <div className="form-message" role="alert">
          <StateBanner tone="danger" title={t(inviteMessage(code))} />
        </div>
      ) : null}
      <div className="form-actions">
        <Button
          type="button"
          variant="primary"
          loading={pending}
          onClick={() => {
            setCode(null);
            startTransition(async () => {
              const result = await acceptInvite(token);
              if (!result.ok) setCode(result.code);
            });
          }}
        >
          {pending ? t("platform.invite.pending") : t("platform.invite.accept")}
        </Button>
      </div>
    </div>
  );
}
