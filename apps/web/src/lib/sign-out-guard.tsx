import { createContext, use, useRef, type ReactNode } from "react";

type SignOutGuard = { current: (() => Promise<void>) | null };
const SignOutGuardContext = createContext<SignOutGuard | null>(null);

/** A mounted form can save pending edits before the shared menu revokes its session. */
export function SignOutGuardProvider({ children }: { children: ReactNode }) {
  const guard = useRef<(() => Promise<void>) | null>(null);
  return <SignOutGuardContext value={guard}>{children}</SignOutGuardContext>;
}

export function useSignOutGuard() {
  return use(SignOutGuardContext);
}
