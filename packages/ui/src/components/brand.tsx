import type { ReactNode } from "react";

export interface TextWordmarkProps {
  name?: string;
  descriptor?: string;
  inverse?: boolean;
  className?: string;
}

/** The default brand is text-only so a supplied mark can replace it without layout changes. */
export function TextWordmark({
  name = "FIL ONE",
  descriptor,
  inverse = false,
  className = "",
}: TextWordmarkProps) {
  const words = name.trim().split(/\s+/u);
  const firstWord = words.shift() ?? name;
  const remainingWords = words.join(" ");

  return (
    <span
      className={`cw-wordmark ${inverse ? "cw-wordmark--inverse" : ""} ${className}`.trim()}
      aria-label={[name, descriptor].filter(Boolean).join(", ")}
    >
      <span className="cw-wordmark__name" aria-hidden="true">
        <span>{firstWord}</span>
        {remainingWords ? (
          <span className="cw-wordmark__counterweight">{remainingWords}</span>
        ) : null}
      </span>
      {descriptor ? (
        <span className="cw-wordmark__descriptor" aria-hidden="true">
          {descriptor}
        </span>
      ) : null}
    </span>
  );
}

export interface BrandSlotProps extends TextWordmarkProps {
  /** A customer or partner logo. The container remains stable when the asset changes. */
  asset?: ReactNode;
  homeLink?: string;
  homeLabel?: string;
}

export function BrandSlot({
  asset,
  homeLink,
  homeLabel = "Home",
  ...wordmarkProps
}: BrandSlotProps) {
  const mark = (
    <span className="cw-brand-slot">
      {asset ?? <TextWordmark {...wordmarkProps} />}
    </span>
  );

  return homeLink ? (
    <a className="cw-brand-link" href={homeLink} aria-label={homeLabel}>
      {mark}
    </a>
  ) : (
    mark
  );
}
