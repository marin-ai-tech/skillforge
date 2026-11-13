import type { ButtonHTMLAttributes, MouseEvent, Ref } from "react";

/**
 * A button that stays focusable while its request runs (fix-pending-focus). `disabled` drops keyboard focus to the
 * page, so a pending button gets aria-disabled and aria-busy instead, and a press meanwhile is ignored — for a
 * submit button that also stops the form from being sent again. `disabled` stays for "not available by meaning"
 * (an empty required field, no rights).
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ pending = false, onClick, className, ...rest }: ButtonProps) {
  const guarded = (e: MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      {...rest}
      className={className ? `${className} aria-disabled:opacity-50` : "aria-disabled:opacity-50"}
      aria-disabled={pending || rest["aria-disabled"] || undefined}
      aria-busy={pending || undefined}
      onClick={guarded}
    />
  );
}
