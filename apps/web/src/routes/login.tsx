import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@it3k/ui/components/card";
import { Button } from "@it3k/ui/components/button";
import { Spinner } from "@it3k/ui/components/spinner";
import { SiGoogle } from "@icons-pack/react-simple-icons";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import z from "zod";

// Better Auth redirects back to `errorCallbackURL` with the failure reason in `?error=`.
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "คุณปฏิเสธการให้สิทธิ์กับ Google",
  banned_user: "บัญชีนี้ถูกระงับการใช้งาน",
  signup_disabled: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน",
  account_not_linked: "อีเมลนี้ถูกใช้กับวิธีเข้าสู่ระบบอื่นแล้ว",
  account_already_linked_to_different_user: "บัญชี Google นี้ถูกผูกกับผู้ใช้อื่นแล้ว",
  email_not_verified: "อีเมลของบัญชี Google นี้ยังไม่ได้รับการยืนยัน",
  email_not_found: "ไม่พบอีเมลจากบัญชี Google นี้",
  unable_to_get_user_info: "ไม่สามารถดึงข้อมูลผู้ใช้จาก Google ได้",
  state_not_found: "เซสชันหมดอายุ กรุณาลองเข้าสู่ระบบอีกครั้ง",
  invalid_callback_request: "คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาลองอีกครั้ง",
  please_restart_the_process: "เซสชันหมดอายุ กรุณาลองเข้าสู่ระบบอีกครั้ง",
};
export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function RouteComponent() {
  const { error, error_description: errorDescription } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    if (!error) return;
    toast.error("เกิดข้อผิดพลาดในการเข้าสู่ระบบ", {
      description: ERROR_MESSAGES[error] ?? errorDescription ?? error,
    });
    // Drop the param so the toast does not reappear on reload.
    void navigate({ search: {}, replace: true });
  }, [error, errorDescription, navigate]);

  async function handleSignIn() {
    setLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
        errorCallbackURL: `${window.location.origin}/login`,
      });
    } catch (err) {
      if (err instanceof Error) {
        toast.error("เกิดข้อผิดพลาดในการเข้าสู่ระบบ", {
          description: err.message,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center items-center w-full">
      <Card className="w-sm">
        <CardHeader>
          <CardTitle className="font-bold">
            <span className="text-primary">IT3Kings</span> Staff
          </CardTitle>
          <CardDescription>Login to your IT3Kings staff account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full disabled:cursor-not-allowed"
            disabled={isLoading}
            onClick={handleSignIn}
          >
            {isLoading ? <Spinner /> : <SiGoogle />} Continue with Google
          </Button>
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground">Staff account is not yet available.</p>
        </CardFooter>
      </Card>
    </div>
  );
}
