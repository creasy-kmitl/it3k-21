import {
  MAX_FILE_SIZE,
  MAX_PHOTO_SIZE,
  MAX_FILES_PER_USER,
  MAX_PENDING_UPLOADS,
  PHOTO_TYPES,
} from "@it3k/db/profile";
import { Alert, AlertDescription } from "@it3k/ui/components/alert";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@it3k/ui/components/empty";
import { Input } from "@it3k/ui/components/input";
import { Progress } from "@it3k/ui/components/progress";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@it3k/ui/components/tabs";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileIcon, ImagePlus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApis } from "@/lib/api-context";
import { fileSize, type LibraryFile } from "@/lib/files";
import { isAccountChanged, isSignedOut } from "@/lib/leadership";
import { useEndSession } from "./session-boundary";

export function FileLibrary({
  userId,
  onClose,
  onSelect,
}: {
  userId: string;
  onClose: () => void;
  onSelect?: (file: LibraryFile) => void;
}) {
  const { files } = useApis();
  const endSession = useEndSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("library");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LibraryFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const library = useQuery({
    queryKey: ["files", userId, { q, page, images: !!onSelect }],
    queryFn: () => files.list({ userId, q, page, images: !!onSelect }),
  });
  useEffect(() => {
    if (isAccountChanged(library.error) || isSignedOut(library.error)) endSession?.();
  }, [library.error, endSession]);
  const remove = useMutation({
    mutationFn: (id: string) => files.remove(id, userId),
    onSuccess: async () => {
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (err) => {
      if (isAccountChanged(err) || isSignedOut(err)) endSession?.();
      toast.error(err.message);
    },
  });

  async function upload(input: FileList | File[]) {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setUploading(true);
    setError("");
    let uploaded = false;
    try {
      for (const file of Array.from(input)) {
        if (controller.signal.aborted) break;
        const max = onSelect ? MAX_PHOTO_SIZE : MAX_FILE_SIZE;
        if (!file.size || file.size > max) throw new Error(`ไฟล์ต้องมีขนาดไม่เกิน ${fileSize(max)}`);
        if (onSelect && !PHOTO_TYPES.some((type) => type === file.type))
          throw new Error("เลือกรูป JPEG, PNG หรือ WebP");
        setUploadName(file.name);
        setProgress(0);
        await files.upload(file, {
          userId,
          signal: controller.signal,
          onProgress: (value) => {
            if (mounted.current) setProgress(value);
          },
        });
        uploaded = true;
      }
      if (mounted.current && uploaded) {
        setTab("library");
        setPage(1);
        setQ("");
      }
    } catch (err) {
      if (isAccountChanged(err) || isSignedOut(err)) endSession?.();
      if (mounted.current && !controller.signal.aborted)
        setError(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      abort.current = null;
      if (mounted.current) setUploading(false);
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{onSelect ? "เลือกรูปที่มั่นใจที่สุด" : "ไฟล์ของฉัน"}</DialogTitle>
          <DialogDescription>
            {onSelect ? "ต้องเห็นใบหน้าชัดเจน ไม่สวมแมสก์ ไม่สวมแว่นตา" : "จัดการไฟล์และนำลิงก์ไปใช้งาน"} ·
            ไฟล์ที่อัปโหลดเปิดผ่านลิงก์สาธารณะได้
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="upload">อัปโหลดไฟล์</TabsTrigger>
            <TabsTrigger value="library">คลังไฟล์</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <section
              aria-label="พื้นที่วางไฟล์"
              className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-8"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void upload(event.dataTransfer.files);
              }}
            >
              <Upload className="size-10 text-muted-foreground" aria-hidden />
              <p>ลากไฟล์มาวางที่นี่ หรือเลือกไฟล์จากอุปกรณ์</p>
              <input
                ref={picker}
                type="file"
                className="sr-only"
                aria-label="เลือกไฟล์อัปโหลด"
                multiple={!onSelect}
                accept={onSelect ? PHOTO_TYPES.join(",") : undefined}
                disabled={uploading}
                onChange={(event) => {
                  if (event.target.files) void upload(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button disabled={uploading} onClick={() => picker.current?.click()}>
                <ImagePlus data-icon="inline-start" />
                เลือกไฟล์
              </Button>
              <p className="text-muted-foreground">
                ขนาดสูงสุด {onSelect ? "10 MB · JPEG, PNG, WebP" : "50 MB ต่อไฟล์"}
              </p>
              <p className="text-muted-foreground">
                สูงสุด {MAX_FILES_PER_USER.toLocaleString("th-TH")} ไฟล์ต่อบัญชี · อัปโหลดค้างได้ไม่เกิน{" "}
                {MAX_PENDING_UPLOADS} รายการ
              </p>
            </section>
          </TabsContent>
          <TabsContent value="library">
            <div className="flex flex-col gap-4">
              {!!library.data?.uploads.length && (
                <section
                  aria-label="รายการอัปโหลดค้าง"
                  className="flex flex-col gap-2 rounded-xl border p-4"
                >
                  <p className="font-medium">รายการอัปโหลดค้าง</p>
                  <p className="text-sm text-muted-foreground">
                    หากการเชื่อมต่อขัดข้อง คุณยกเลิกรายการเหล่านี้เพื่อคืนพื้นที่และเริ่มใหม่ได้
                  </p>
                  {library.data.uploads.map((file) => (
                    <div key={file.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {file.name} · {fileSize(file.size)}
                      </span>
                      <Button
                        variant="outline"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(file.id)}
                      >
                        ยกเลิก {file.name}
                      </Button>
                    </div>
                  ))}
                </section>
              )}
              <Input
                type="search"
                aria-label="ค้นหาไฟล์"
                placeholder="ค้นหาไฟล์ในคลัง"
                maxLength={100}
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
              />
              <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
                <div className="flex min-h-64 flex-col gap-4">
                  {library.isPending ? (
                    <Skeleton className="h-64 w-full" />
                  ) : library.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {library.error.message}
                        <Button variant="outline" onClick={() => void library.refetch()}>
                          ลองอีกครั้ง
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : !library.data.items.length ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>ยังไม่มีไฟล์</EmptyTitle>
                        <EmptyDescription>อัปโหลดไฟล์เพื่อเริ่มต้นใช้งาน</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {library.data.items.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className={cn(
                            "relative flex flex-col gap-2 rounded-xl border p-2 text-left focus-visible:outline-2 focus-visible:outline-ring",
                            selected?.id === file.id && "border-primary bg-accent",
                          )}
                          aria-label={file.name}
                          aria-pressed={selected?.id === file.id}
                          onClick={() => setSelected(file)}
                        >
                          {PHOTO_TYPES.some((type) => type === file.contentType) ? (
                            <img
                              src={file.url}
                              alt=""
                              loading="lazy"
                              className="aspect-square w-full rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex aspect-square items-center justify-center rounded-lg bg-muted">
                              <FileIcon className="size-10 text-muted-foreground" />
                            </div>
                          )}
                          {selected?.id === file.id && (
                            <Check
                              className="absolute right-3 top-3 size-5 text-primary"
                              aria-hidden
                            />
                          )}
                          <span className="w-full truncate text-xs">{file.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(page > 1 || library.data?.hasMore) && (
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        ก่อนหน้า
                      </Button>
                      <span>หน้า {page}</span>
                      <Button
                        variant="outline"
                        disabled={!library.data?.hasMore}
                        onClick={() => setPage(page + 1)}
                      >
                        ถัดไป
                      </Button>
                    </div>
                  )}
                </div>
                <aside className="flex flex-col gap-3 rounded-xl border p-4">
                  {selected ? (
                    <>
                      <p className="break-all font-medium">{selected.name}</p>
                      <p className="text-muted-foreground">
                        {selected.contentType} · {fileSize(selected.size)}
                      </p>
                      <p className="text-muted-foreground">
                        {new Date(selected.createdAt).toLocaleDateString("th-TH")}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(selected.url)
                            .then(() => toast.success("คัดลอกลิงก์แล้ว"))
                            .catch(() => toast.error("คัดลอกไม่สำเร็จ"));
                        }}
                      >
                        <Copy data-icon="inline-start" />
                        คัดลอกลิงก์
                      </Button>
                      <a
                        href={selected.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        เปิดไฟล์
                      </a>
                      <Button
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`ลบ ${selected.name} ถาวร?`))
                            remove.mutate(selected.id);
                        }}
                      >
                        <Trash2 data-icon="inline-start" />
                        ลบไฟล์
                      </Button>
                    </>
                  ) : (
                    <p className="text-muted-foreground">เลือกไฟล์เพื่อดูรายละเอียด</p>
                  )}
                </aside>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        {uploading && (
          <div className="flex flex-col gap-2" role="status">
            <p className="truncate">กำลังอัปโหลด {uploadName}</p>
            <Progress value={progress} aria-label="ความคืบหน้าการอัปโหลด" />
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              ยกเลิกอัปโหลด
            </Button>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            ใช้พื้นที่ {fileSize(library.data?.used ?? 0)} / {fileSize(library.data?.limit ?? 0)}
          </span>
          <DialogClose render={<Button variant="outline" />}>ปิด</DialogClose>
          {onSelect && (
            <Button
              disabled={!selected || uploading}
              onClick={() => {
                if (selected) onSelect(selected);
              }}
            >
              ใช้รูปนี้
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
