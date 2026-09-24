"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { lifecycleCopy } from "./copy";
import { formatCalendarDay } from "./projection-fields";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.handoff;

export function DemoOrderHandoff({
  orders,
}: {
  orders: readonly {
    id: string;
    reference: string;
    startsOn: string;
    submittedAt?: string;
    ready: boolean;
  }[];
}) {
  const router = useRouter();
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const busy = useRef(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  async function submit(id: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(id);
    setMessage("");
    try {
      const csrf =
        document.cookie
          .split("; ")
          .find((item) => item.startsWith("clockwork-csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch("/api/demo/orders/provision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
          "idempotency-key": `provision-demo-order-${id}`,
        },
        body: JSON.stringify({ orderId: id }),
      });
      if (!response.ok) {
        // The route answers in English problem details for API callers; the
        // reader is told what happened in their language, keyed on facts: 403
        // is the authority check, the `DEMO_PROVISIONING_REFUSED` code is the
        // provisioner refusing the order, anything else a failed submission.
        // The code, not the 422 status, decides "refused": the same route
        // also answers 422 for a malformed idempotency key.
        const problem: unknown = await response.json().catch(() => null);
        const refused =
          typeof problem === "object" &&
          problem !== null &&
          "code" in problem &&
          problem.code === "DEMO_PROVISIONING_REFUSED";
        setMessage(
          t(
            response.status === 403
              ? copy.forbidden
              : refused
                ? copy.refused
                : copy.failed,
          ),
        );
        return;
      }
      setMessage(t(copy.received));
      router.refresh();
    } catch {
      setMessage(t(copy.failed));
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  return (
    <section className={styles.section} aria-label={t(copy.label)}>
      <h2>{t(copy.heading)}</h2>
      <p>{t(copy.intro)}</p>
      {orders.length ? (
        <ul>
          {orders.map((order) => {
            const starts = t(copy.serviceStarts, {
              date:
                formatCalendarDay(order.startsOn, formattingLocale) ??
                order.startsOn,
            });
            const state = order.submittedAt ? (
              t(copy.submitted, {
                time: new Date(order.submittedAt).toLocaleString(
                  formattingLocale,
                ),
              })
            ) : order.ready ? (
              <button
                disabled={Boolean(pending)}
                onClick={() => void submit(order.id)}
              >
                {pending === order.id ? t(copy.submitting) : t(copy.submit)}
              </button>
            ) : (
              t(copy.historical)
            );
            return (
              <li key={order.id}>
                {richText(t, "common.join.labels", {
                  first: (
                    <strong>
                      <bdi>{order.reference}</bdi>
                    </strong>
                  ),
                  second: richText(t, "common.join.labels", {
                    first: starts,
                    second: state,
                  }),
                })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>{t(copy.empty)}</p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
