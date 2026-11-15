import { useEffect } from "react";
import { toast } from "sonner";

const OFFLINE_TOAST = "connection-offline";

/**
 * Tells people when their device drops off the internet, and when it is back.
 * React Query refetches on reconnect by itself; this only explains the pause.
 */
export function ConnectionStatus() {
  useEffect(() => {
    const offline = () =>
      toast.warning("ออฟไลน์อยู่", {
        id: OFFLINE_TOAST,
        description: "ไม่มีการเชื่อมต่ออินเทอร์เน็ต บางอย่างอาจใช้งานไม่ได้จนกว่าจะกลับมาออนไลน์",
        duration: Number.POSITIVE_INFINITY,
      });
    const online = () => {
      toast.dismiss(OFFLINE_TOAST);
      toast.success("กลับมาออนไลน์แล้ว", { duration: 2500 });
    };
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);
  return null;
}
