"use client";
import { useFormattingLocale } from "@/src/i18n/client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./finance-lifecycle.module.css";
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
      const data = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(data.detail ?? "Provisioning request failed.");
      setMessage(
        "Demo provisioner received the order. This is dispatch evidence, not service activation.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry the request.");
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  return (
    <section className={styles.section} aria-label="Accepted order handoff">
      <h2>Accepted orders · demo provisioning</h2>
      <p>
        Orders appear here as soon as the customer accepts. Submit the saved
        entitlements to the demo provisioner; an operation reference confirms
        receipt. Real service activation needs a provider completion result.
      </p>
      {orders.length ? (
        <ul>
          {orders.map((order) => (
            <li key={order.id}>
              <strong>{order.reference}</strong> · Service starts{" "}
              {order.startsOn} ·{" "}
              {order.submittedAt ? (
                `Request submitted ${new Date(order.submittedAt).toLocaleString(formattingLocale)}`
              ) : order.ready ? (
                <button
                  disabled={Boolean(pending)}
                  onClick={() => void submit(order.id)}
                >
                  {pending === order.id
                    ? "Submitting…"
                    : "Submit to demo provisioner"}
                </button>
              ) : (
                "Historical demo order · provisioning source unavailable"
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No accepted demo orders yet.</p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
