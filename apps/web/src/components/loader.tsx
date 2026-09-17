import { Spinner } from "@it3k/ui/components/spinner";

export default function Loader() {
  return (
    <div className="flex h-full w-full flex-1 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}
