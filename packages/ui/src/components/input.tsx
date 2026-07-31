import { useId } from "react";
import type {
  FieldsetHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldFrameProps {
  fieldId: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  optionalLabel?: ReactNode;
  children: ReactNode;
  className?: string;
}

function FieldFrame({
  fieldId,
  label,
  help,
  error,
  optionalLabel,
  children,
  className = "",
}: FieldFrameProps) {
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;
  return (
    <div
      className={`cw-field ${error ? "cw-field--error" : ""} ${className}`.trim()}
    >
      <label className="cw-field__label" htmlFor={fieldId}>
        <span>{label}</span>
        {optionalLabel ? (
          <span className="cw-field__optional">{optionalLabel}</span>
        ) : null}
      </label>
      {children}
      {help ? (
        <span className="cw-help" id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className="cw-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function describedBy(
  fieldId: string,
  ariaDescribedBy: string | undefined,
  help: ReactNode,
  error: ReactNode,
): string | undefined {
  return (
    [
      ariaDescribedBy,
      help ? `${fieldId}-help` : undefined,
      error ? `${fieldId}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  optionalLabel?: ReactNode;
  fieldClassName?: string;
  size?: "small" | "medium" | "large";
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Input({
  label,
  help,
  error,
  optionalLabel,
  fieldClassName,
  size = "medium",
  leading,
  trailing,
  id,
  className = "",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      {...(help ? { help } : {})}
      {...(error ? { error } : {})}
      {...(optionalLabel ? { optionalLabel } : {})}
      {...(fieldClassName ? { className: fieldClassName } : {})}
    >
      <span className="cw-input-frame">
        {leading ? (
          <span className="cw-input-frame__leading" aria-hidden="true">
            {leading}
          </span>
        ) : null}
        <input
          className={`cw-input cw-input--${size} ${className}`.trim()}
          id={fieldId}
          aria-describedby={describedBy(fieldId, ariaDescribedBy, help, error)}
          aria-invalid={ariaInvalid ?? (error ? true : undefined)}
          {...props}
        />
        {trailing ? (
          <span className="cw-input-frame__trailing">{trailing}</span>
        ) : null}
      </span>
    </FieldFrame>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  optionalLabel?: ReactNode;
  fieldClassName?: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export function Select({
  label,
  help,
  error,
  optionalLabel,
  fieldClassName,
  options,
  placeholder,
  id,
  className = "",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      {...(help ? { help } : {})}
      {...(error ? { error } : {})}
      {...(optionalLabel ? { optionalLabel } : {})}
      {...(fieldClassName ? { className: fieldClassName } : {})}
    >
      <select
        className={`cw-select ${className}`.trim()}
        id={fieldId}
        aria-describedby={describedBy(fieldId, ariaDescribedBy, help, error)}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  optionalLabel?: ReactNode;
  fieldClassName?: string;
}

export function Textarea({
  label,
  help,
  error,
  optionalLabel,
  fieldClassName,
  id,
  className = "",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      {...(help ? { help } : {})}
      {...(error ? { error } : {})}
      {...(optionalLabel ? { optionalLabel } : {})}
      {...(fieldClassName ? { className: fieldClassName } : {})}
    >
      <textarea
        className={`cw-textarea ${className}`.trim()}
        id={fieldId}
        aria-describedby={describedBy(fieldId, ariaDescribedBy, help, error)}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        {...props}
      />
    </FieldFrame>
  );
}

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export function Checkbox({
  label,
  description,
  error,
  id,
  className = "",
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? `check-${generatedId.replaceAll(":", "")}`;
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={`cw-check-field ${className}`.trim()}>
      <input
        className="cw-checkbox"
        type="checkbox"
        id={fieldId}
        aria-describedby={
          [description ? descriptionId : undefined, error ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        aria-invalid={error ? true : undefined}
        {...props}
      />
      <div>
        <label htmlFor={fieldId}>{label}</label>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {error ? (
          <p className="cw-field__error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function RadioGroup({
  legend,
  name,
  options,
  value,
  defaultValue,
  onChange,
  error,
  className = "",
}: {
  legend: ReactNode;
  name: string;
  options: readonly RadioOption[];
  value?: string;
  defaultValue?: string;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
  error?: ReactNode;
  className?: string;
}) {
  const generatedId = useId().replaceAll(":", "");
  return (
    <fieldset className={`cw-radio-group ${className}`.trim()}>
      <legend>{legend}</legend>
      {options.map((option) => {
        const optionId = `${generatedId}-${option.value}`;
        return (
          <div className="cw-radio-option" key={option.value}>
            <input
              type="radio"
              id={optionId}
              name={name}
              value={option.value}
              disabled={option.disabled}
              {...(value === undefined
                ? { defaultChecked: defaultValue === option.value }
                : { checked: value === option.value })}
              {...(onChange ? { onChange } : {})}
            />
            <div>
              <label htmlFor={optionId}>{option.label}</label>
              {option.description ? <p>{option.description}</p> : null}
            </div>
          </div>
        );
      })}
      {error ? (
        <p className="cw-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function Fieldset({
  legend,
  description,
  children,
  className = "",
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement> & {
  legend: ReactNode;
  description?: ReactNode;
}) {
  return (
    <fieldset className={`cw-fieldset ${className}`.trim()} {...props}>
      <legend>{legend}</legend>
      {description ? <p>{description}</p> : null}
      <div className="cw-fieldset__content">{children}</div>
    </fieldset>
  );
}

export function FormActions({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`cw-form-actions ${className}`.trim()}>{children}</div>
  );
}
