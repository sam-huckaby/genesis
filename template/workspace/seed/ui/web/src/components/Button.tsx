import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  active?: boolean;
};

export default function Button({
  variant = "primary",
  active = false,
  className,
  ...props
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, active ? "is-active" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...props} />;
}
