import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  active?: boolean;
  icon?: ReactNode;
};

export default function Button({
  variant = "primary",
  active = false,
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, active ? "is-active" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...props}>
      {icon ? <span className="btn-icon-wrap">{icon}</span> : null}
      {children}
    </button>
  );
}
