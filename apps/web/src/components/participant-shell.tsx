import { isMember } from "@it3k/auth/permissions";
import { Button } from "@it3k/ui/components/button";
import { Link } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SignOutGuardProvider } from "@/lib/sign-out-guard";
import { FileLibrary } from "./file-library";
import UserMenu from "./user-menu";
import { SessionBoundary } from "./session-boundary";

export function ParticipantShell({
  children,
  role,
  userId,
}: {
  children: ReactNode;
  role: string;
  userId: string;
}) {
  const [files, setFiles] = useState(false);
  return (
    <SessionBoundary key={userId} userId={userId}>
      <SignOutGuardProvider>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <Link to="/" className="text-xl font-semibold text-primary">
              IT3Kings
            </Link>
            <nav className="flex flex-wrap items-center gap-2" aria-label="บัญชีผู้เข้าร่วม">
              {isMember(role) && <Link to="/staff/dashboard">ระบบทีมงาน</Link>}
              <Button variant="ghost" onClick={() => setFiles(true)}>
                <FolderOpen data-icon="inline-start" />
                ไฟล์ของฉัน
              </Button>
              <UserMenu />
            </nav>
          </header>
          <main>{children}</main>
          {files && <FileLibrary userId={userId} onClose={() => setFiles(false)} />}
        </div>
      </SignOutGuardProvider>
    </SessionBoundary>
  );
}
