import { useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
}
export function Input({
  label,
  help,
  id,
  "aria-describedby": ariaDescribedBy,
  ...props
}: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  const helpId = `${fieldId}-help`;
  return (
    <label className="cw-field" htmlFor={fieldId}>
      <span>{label}</span>
      <input
        className="cw-input"
        id={fieldId}
        aria-describedby={
          [ariaDescribedBy, help ? helpId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        {...props}
      />
      {help ? (
        <span className="cw-help" id={helpId}>
          {help}
        </span>
      ) : null}
    </label>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  help?: string;
  options: readonly { value: string; label: string }[];
}
export function Select({
  label,
  help,
  options,
  id,
  "aria-describedby": ariaDescribedBy,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  const helpId = `${fieldId}-help`;
  return (
    <label className="cw-field" htmlFor={fieldId}>
      <span>{label}</span>
      <select
        className="cw-select"
        id={fieldId}
        aria-describedby={
          [ariaDescribedBy, help ? helpId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help ? (
        <span className="cw-help" id={helpId}>
          {help}
        </span>
      ) : null}
    </label>
  );
}
