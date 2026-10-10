// Button hierarchy (UI-0): primary = red/white (main action), secondary = white + border (default), danger = destructive
// recovery actions (semantically separate from primary), ghost = low-priority. Native <button>: keyboard and focus work.
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT_CLASS: Record<ButtonVariant, string> = { primary: "primary", secondary: "", danger: "danger", ghost: "ghost" };

export function Button({
  variant = "secondary",
  size,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "small" }) {
  const cls = [VARIANT_CLASS[variant], size === "small" ? "small" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={cls || undefined} {...rest} />;
}
