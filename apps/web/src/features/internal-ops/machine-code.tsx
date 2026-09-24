import { Fragment } from "react";

/**
 * A machine identifier -- an event type, task name, error code or UUID -- with
 * line-break opportunities after its own separators.
 *
 * Such a value is one token to the browser, so in a narrow table column it
 * either widens the column past its card or, in German, French, Spanish and
 * Portuguese, gets hyphenated like a word ("activate_sub-scription", a name
 * that does not exist). Breaking after `.`, `_`, `-` or `:` keeps every
 * character, adds none, and splits the value only where its own structure
 * does. Copying the text copies the identifier exactly.
 */
export function MachineCode({
  value,
  className,
}: {
  value: string;
  className?: string | undefined;
}) {
  const parts = value.split(/(?<=[._:-])/u);
  return (
    <span className={className} translate="no">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
