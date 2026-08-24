import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "quiet";
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`button button-${variant} ${className}`.trim()} {...props} />;
}

