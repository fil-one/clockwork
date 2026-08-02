import type { ReactNode } from "react";

export interface TextWordmarkProps {
  name?: string;
  descriptor?: string;
  inverse?: boolean;
  className?: string;
}

/**
 * The default brand is text-only so a supplied mark can replace it without
 * layout changes. The leading word sets the regular weight and the trailing
 * word takes the bold weight of the same face, not a second family or colour.
 */
export function TextWordmark({
  name = "Fil One",
  descriptor,
  inverse = false,
  className = "",
}: TextWordmarkProps) {
  const words = name.trim().split(/\s+/u);
  const leadWord = words.shift() ?? name;
  const emphasisWords = words.join(" ");

  return (
    <span
      className={`cw-wordmark ${inverse ? "cw-wordmark--inverse" : ""} ${className}`.trim()}
      aria-label={[name, descriptor].filter(Boolean).join(", ")}
    >
      <span className="cw-wordmark__name" aria-hidden="true">
        <span>{leadWord}</span>
        {emphasisWords ? (
          <span className="cw-wordmark__emphasis">{emphasisWords}</span>
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

/** The two supplied marks. Each keeps its own intrinsic ratio inside the brand slot. */
const MARK_DIMENSIONS = {
  wordmark: { width: 3863, height: 1000 },
  icon: { width: 1000, height: 1000 },
} as const;

export interface BrandLogoProps extends TextWordmarkProps {
  /** The resolved asset path. Without one the remaining props render the text mark. */
  src?: string;
  mark?: keyof typeof MARK_DIMENSIONS;
}

/** The mark is decorative here: the accessible name belongs to the link around it. */
export function BrandLogo({
  src,
  mark = "wordmark",
  className = "",
  ...wordmarkProps
}: BrandLogoProps) {
  if (!src) {
    return <TextWordmark className={className} {...wordmarkProps} />;
  }

  const { width, height } = MARK_DIMENSIONS[mark];

  return (
    <img
      className={`cw-brand-logo ${className}`.trim()}
      src={src}
      alt=""
      width={width}
      height={height}
      data-mark={mark}
    />
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
