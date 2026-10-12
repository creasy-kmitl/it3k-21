import { Spinner } from "@it3k/ui/components/spinner";

// Centered on the viewport rather than its parent: it renders wherever a route
// is pending, and those parents only have a min-height, so `h-full` could not
// fill them and the spinner sat at the top.
export default function Loader() {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}
