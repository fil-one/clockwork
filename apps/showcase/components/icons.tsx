"use client";
import { useI18n } from "./i18n-provider";
import type { CSSProperties } from "react";
export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      className="directional-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} />
    </svg>
  );
}
export function Check() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
export function Symbol({
  kind,
}: {
  kind: "quote" | "control" | "connect" | "partner" | "clock" | "bill";
}) {
  const paths = {
    quote: "M6 3h9l4 4v14H6V3Zm8 0v5h5M9 12h7m-7 4h5",
    control: "M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7l-9-4Zm-4 9 3 3 5-6",
    connect: "M8 8h8v8H8V8ZM12 2v6m0 8v6M2 12h6m8 0h6",
    partner:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm9-7a4 4 0 0 1 0 8m4 9v-2a4 4 0 0 0-3-4",
    clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    bill: "M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 5h8m-8 4h8m-8 4h4",
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
export function StageLine({ active = 2 }: { active?: number }) {
  const { t } = useI18n();
  return (
    <div
      className="stage-line"
      aria-label={t("sales.quote.approve.accept.activate.bill.7ecb2")}
    >
      {[
        t("sales.quote.eb4cd"),
        t("sales.approve.6007a"),
        t("sales.accept.89713"),
        t("sales.activate.24433"),
        t("sales.bill.e5178"),
      ].map((label, index) => (
        <div
          className={index <= active ? "stage-node reached" : "stage-node"}
          key={label}
          style={{ "--node": index } as CSSProperties}
        >
          <span>{index < active ? <Check /> : `0${index + 1}`}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}
