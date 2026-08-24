import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className="form-field">
      <label htmlFor={htmlFor}>{label}</label>
      {control}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
