import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trophy } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { MatchForm } from "@/components/scores/match-form";
import { useApis } from "@/lib/api-context";
import type { MatchInput } from "@/lib/matches";

const QUERY_KEY = ["matches"];

/** A whole page for a new match, with room for the timeline and its breaks. */
export function NewMatchPage() {
  const { matches } = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const backToList = () => navigate({ to: "/staff/scores" });

  const create = useMutation({
    mutationFn: (input: MatchInput) => matches.create(input),
    onSuccess: async () => {
      toast.success("เพิ่มแมตช์แล้ว");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      await backToList();
    },
    onError: (error: Error) => toast.error(`เพิ่มแมตช์ไม่สำเร็จ: ${error.message}`),
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <Link
        to="/staff/scores"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        กลับไปหน้าคะแนน
      </Link>
      <PageHeader
        icon={Trophy}
        title="เพิ่มแมตช์"
        description="กำหนดเวลาแข่ง จำนวนนาที และช่วงพัก แมตช์ใหม่เริ่มที่ 0 : 0"
      />
      <div className="rounded-2xl border bg-card p-6">
        <MatchForm
          pending={create.isPending}
          onCancel={backToList}
          onSubmit={(input) => create.mutate(input)}
        />
      </div>
    </div>
  );
}
