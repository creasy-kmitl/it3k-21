import { Button } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Loader2Icon, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

type LoadingButtonProps = ComponentProps<typeof Button> & {
  /** The request this button started is still running. */
  loading: boolean;
  /** Shown at the start of the button, and swapped for the spinner while loading. */
  icon?: LucideIcon;
  /** Classes for the icon and the spinner, such as a colour. */
  iconClassName?: string;
};

/**
 * A button that calls the API. While `loading` it is disabled, marked
 * `aria-busy`, and shows a spinner in place of its icon, so the button keeps
 * its size and people can tell their click landed.
 */
export function LoadingButton({
  loading,
  icon: Icon,
  iconClassName,
  disabled,
  children,
  ...props
}: LoadingButtonProps) {
  const slot = children ? "inline-start" : undefined;
  return (
    <Button disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {/* No size class, so the button's own icon size (size-3 on xs) applies. */}
      {loading ? (
        <Loader2Icon
          data-slot="spinner"
          data-icon={slot}
          aria-hidden
          className={cn("animate-spin", iconClassName)}
        />
      ) : (
        Icon && <Icon data-icon={slot} aria-hidden className={iconClassName} />
      )}
      {children}
    </Button>
  );
}
