import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { ButtonGroup } from "@it3k/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Spinner } from "@it3k/ui/components/spinner";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChartColumn,
  ChevronDown,
  Download,
  FileArchive,
  FileSpreadsheet,
  Rows3,
  Link2,
  List,
  LockKeyhole,
  Plus,
  ScanQrCode,
  Search,
  SearchX,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { BulkCreate, linksSheet } from "@/components/links/bulk-create";
import { LinkForm } from "@/components/links/link-form";
import { CopyButton, LinkStateBadge, displayUrl } from "@/components/links/link-parts";
import { LinkSheet } from "@/components/links/link-sheet";
import { QrZipPanel } from "@/components/links/qr-zip-panel";
import { PageHeader } from "@/components/page-header";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useApis } from "@/lib/api-context";
import { xlsxBlob } from "@/lib/xlsx";
import { type ShortLink, linkError } from "@/lib/links";
import { type QrBrowser, qrBrowser } from "@/lib/qr-export";

/** Days of visits the spreadsheet export covers: the longest chart range. */
const REPORT_DAYS = 90;

const SCOPES: Segment<boolean>[] = [
  { value: false, label: "ทั้งหมด", icon: List },
  { value: true, label: "ของฉัน", icon: UserRound },
];

function LinkRow({ link, onOpen }: { link: ShortLink; onOpen: () => void }) {
  return (
    <li className="relative flex items-center gap-3 rounded-2xl border p-3 text-sm hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* The whole row opens the link; the copy button sits above this. */}
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {link.title}
          </button>
          <LinkStateBadge state={link.state} />
          {link.hasPassword && (
            <LockKeyhole aria-label="มีรหัสผ่าน" className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <code className="truncate font-mono text-xs text-primary">{displayUrl(link.shortUrl)}</code>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <ArrowRight aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{displayUrl(link.destination)}</span>
        </span>
        {link.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {link.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-muted-foreground">
                <Tag aria-hidden data-icon="inline-start" />
                {tag}
              </Badge>
            ))}
          </span>
        )}
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground sm:flex">
        <span className="flex items-center gap-1" title="เปิดผ่าน QR">
          <ScanQrCode aria-hidden className="size-3.5" />
          <span className="sr-only">ผ่าน QR</span>
          {link.visits.qr.toLocaleString("th-TH")}
        </span>
        <span className="flex items-center gap-1" title="เปิดผ่านลิงก์">
          <Link2 aria-hidden className="size-3.5" />
          <span className="sr-only">ผ่านลิงก์</span>
          {link.visits.link.toLocaleString("th-TH")}
        </span>
      </div>
      <CopyButton text={link.qrUrl} label="ลิงก์สำหรับ QR" className="relative z-10" />
    </li>
  );
}

export function LinksPage({ browser = qrBrowser }: { browser?: QrBrowser }) {
  const { links } = useApis();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);

  const list = useQuery({
    queryKey: ["links", "list", { q, mine, tag }],
    queryFn: () => links.list({ q, mine, tag: tag ?? undefined }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: links.create,
    onSuccess: async (link) => {
      setCreating(false);
      toast.success("สร้างลิงก์แล้ว");
      await queryClient.invalidateQueries({ queryKey: ["links"] });
      setOpenId(link.id);
    },
    onError: (error) => {
      if (!linkError(error)) toast.error(`สร้างลิงก์ไม่สำเร็จ: ${error.message}`);
    },
  });

  const filtered = q !== "" || mine || tag !== null;
  const tags = list.data?.tags ?? [];
  const shown = list.data?.items ?? [];
  // Names files after what is shown, e.g. it3k-links-rov.xlsx for a tag.
  const scope = ["it3k", "links", tag, mine ? "mine" : null].filter(Boolean).join("-");

  async function downloadVisits() {
    setReporting(true);
    try {
      const report = await links.visits({ days: REPORT_DAYS, mine, tag: tag ?? undefined });
      browser.download(
        xlsxBlob("visits", [
          ["day", "slug", "title", "visits_qr", "visits_link"],
          ...report.rows.map((row) => [row.day, row.slug, row.title, row.qr, row.link]),
        ]),
        `${scope}-visits-${report.from}-${report.to}.xlsx`,
      );
    } catch (error) {
      toast.error(`ดาวน์โหลดรายงานไม่สำเร็จ: ${error instanceof Error ? error.message : error}`);
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={Link2}
        title="ลิงก์สั้น"
        description="ลิงก์ของงานที่เปลี่ยนปลายทางได้ภายหลัง พิมพ์ QR ครั้งเดียวแล้วใช้ได้ตลอด"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="ค้นหาชื่อ ลิงก์ หรือปลายทาง"
            placeholder="ค้นหาชื่อ ลิงก์ หรือปลายทาง"
            className="pl-9"
            maxLength={64}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <SegmentedControl label="แสดงลิงก์" segments={SCOPES} value={mine} onChange={setMine} />
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={shown.length === 0 && !reporting}
              render={<Button variant="outline" />}
            >
              {reporting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              ส่งออก
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setZipOpen(true)}>
                <FileArchive />
                QR ของ {shown.length} ลิงก์ที่แสดง (.zip)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => browser.download(linksSheet(shown), `${scope}.xlsx`)}
              >
                <FileSpreadsheet />
                รายการลิงก์ (Excel)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void downloadVisits()}>
                <ChartColumn />
                ยอดเข้าชมรายวัน {REPORT_DAYS} วัน (Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {list.data?.canCreate && (
            <ButtonGroup aria-label="สร้างลิงก์" className="flex-1 sm:flex-none">
              <Button className="flex-1" onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                สร้างลิงก์
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon" aria-label="วิธีสร้างลิงก์อื่น" />}>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onClick={() => setBulkOpen(true)}>
                    <Rows3 />
                    สร้างหลายลิงก์จากตาราง
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          )}
        </div>
      </div>

      {tags.length > 0 && (
        <fieldset aria-label="กรองตามแท็ก" className="m-0 -mt-3 flex flex-wrap gap-1.5 border-0 p-0">
          {tags.map((name) => {
            const pressed = tag === name;
            return (
              <Button
                key={name}
                size="xs"
                variant={pressed ? "secondary" : "ghost"}
                aria-pressed={pressed}
                className={pressed ? "ring-1 ring-border" : "text-muted-foreground"}
                onClick={() => setTag(pressed ? null : name)}
              >
                <Tag data-icon="inline-start" />
                {name}
                {pressed && <X data-icon="inline-end" />}
              </Button>
            );
          })}
        </fieldset>
      )}

      {list.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          โหลดลิงก์ไม่สำเร็จ: {list.error.message}
        </p>
      ) : list.data.items.length === 0 ? (
        <Empty className="flex-none border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">{filtered ? <SearchX /> : <Link2 />}</EmptyMedia>
            <EmptyTitle>{filtered ? "ไม่พบลิงก์" : "ยังไม่มีลิงก์สั้น"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "ลองค้นหาด้วยคำอื่น เอาตัวกรองแท็กออก หรือดูลิงก์ทั้งหมด"
                : "สร้างลิงก์แล้วนำไปทำ QR เปลี่ยนปลายทางได้ภายหลังโดยไม่ต้องพิมพ์ใหม่"}
            </EmptyDescription>
          </EmptyHeader>
          {!filtered && list.data.canCreate && (
            <EmptyContent>
              <Button onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                สร้างลิงก์แรก
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <ul aria-label="ลิงก์สั้น" aria-busy={list.isFetching} className="flex flex-col gap-2">
          {list.data.items.map((link) => (
            <LinkRow key={link.id} link={link} onOpen={() => setOpenId(link.id)} />
          ))}
          {list.data.truncated && (
            <li className="text-center text-xs text-muted-foreground">
              แสดง {list.data.items.length} ลิงก์ล่าสุด ค้นหาเพื่อดูลิงก์ที่เหลือ
            </li>
          )}
        </ul>
      )}

      <SideDrawer
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) create.reset();
        }}
        title="สร้างลิงก์สั้น"
        description="ลิงก์อยู่บนโดเมนของงาน ชื่อท้ายลิงก์ตั้งแล้วเปลี่ยนไม่ได้ แต่ปลายทางเปลี่ยนได้เสมอ"
        width="32rem"
      >
        {creating && (
          <LinkForm
            submitting={create.isPending}
            serverError={linkError(create.error)}
            knownTags={tags}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              create.mutate({
                title: values.title,
                destination: values.destination,
                ...(values.slug ? { slug: values.slug } : {}),
                ...(values.expiresAt !== null ? { expiresAt: values.expiresAt } : {}),
                ...(values.fallbackUrl ? { fallbackUrl: values.fallbackUrl } : {}),
                ...(values.tags.length > 0 ? { tags: values.tags } : {}),
                ...(values.password ? { password: values.password } : {}),
              })
            }
          />
        )}
      </SideDrawer>

      <SideDrawer
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="สร้างหลายลิงก์จากตาราง"
        description="วางจาก Google Sheets หรือ Excel หรืออัปโหลด CSV ตรวจทุกแถวก่อนสร้าง แล้วดาวน์โหลด QR ทั้งหมดเป็น zip"
        width="40rem"
      >
        {bulkOpen && <BulkCreate browser={browser} onDone={() => setBulkOpen(false)} />}
      </SideDrawer>

      <SideDrawer
        open={zipOpen}
        onOpenChange={setZipOpen}
        title="ดาวน์โหลด QR"
        description={`QR ของ ${shown.length} ลิงก์ที่แสดงอยู่ตามตัวกรองตอนนี้`}
        width="32rem"
      >
        {zipOpen && <QrZipPanel links={shown} fileName={`${scope}-qr`} browser={browser} />}
      </SideDrawer>

      <LinkSheet
        linkId={openId}
        knownTags={tags}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
    </div>
  );
}
