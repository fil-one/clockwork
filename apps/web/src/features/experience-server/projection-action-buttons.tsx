"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@clockwork/ui";

import { sendProjectionAction } from "@/src/features/contracts/experience-client";

import type { ExperienceAudience, ProjectionChannel } from "./model";
import { canRunProjectionAction } from "./projection-authorization";

export function ProjectionActionButtons({
  audience,
  channel,
  recordKey,
  projectionId,
  version,
  actions,
  roles,
}: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  recordKey: string;
  projectionId: string;
  version: number;
  actions: readonly string[];
  roles: readonly string[];
}) {
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const authorizedActions = actions.filter((action) =>
    canRunProjectionAction(roles, audience, channel, action),
  );
  if (authorizedActions.length === 0) return <span>Read only</span>;
  return (
    <div>
      {authorizedActions.map((action) => (
        <Button
          key={action}
          size="small"
          variant="secondary"
          disabled={pending !== null}
          onClick={() => {
            setPending(action);
            setMessage("");
            const idempotencyKey =
              keys.current.get(action) ?? crypto.randomUUID();
            keys.current.set(action, idempotencyKey);
            void sendProjectionAction(
              {
                audience,
                channel,
                recordKey,
                projectionId,
                action,
                expectedVersion: version,
              },
              { idempotencyKey },
            )
              .then(() => {
                setMessage(`${action.replaceAll("_", " ")} queued`);
                router.refresh();
              })
              .catch((error: unknown) => {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "The record changed. Refresh before retrying.",
                );
              })
              .finally(() => setPending(null));
          }}
        >
          {pending === action ? "Submitting…" : action.replaceAll("_", " ")}
        </Button>
      ))}
      {message ? <p aria-live="polite">{message}</p> : null}
    </div>
  );
}
