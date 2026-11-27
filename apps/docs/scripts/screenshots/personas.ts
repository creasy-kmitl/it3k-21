import type { Institution } from "@it3k/db/profile";

/**
 * The made-up accounts the guide's screenshots are taken as. Every id starts
 * with `demo-` and every address is on example.test, so seed.ts can find and
 * replace them, and nothing here belongs to a real person.
 */
export type Persona = {
  id: string;
  name: string;
  nickname: string;
  prefix: "นาย" | "นาง" | "นางสาว";
  role: string;
  department?: string; // department code
  seat?: "head" | "vicehead";
  institution?: Institution;
  /** Submitted participant profile, with this avatar (scripts/screenshots/avatars). */
  avatar?: number;
};

const mail = (id: string) => `${id.replace(/^demo-/, "")}@example.test`;
export const emailOf = (persona: Persona) => mail(persona.id);

/** Accounts the screenshots sign in as. */
export const PERSONAS = {
  guest: {
    id: "demo-guest",
    name: "ธนกร ศรีสุข",
    nickname: "กร",
    prefix: "นาย",
    role: "guest",
  },
  participant: {
    id: "demo-participant",
    name: "ปภาวรินทร์ ใจงาม",
    nickname: "มิ้นท์",
    prefix: "นางสาว",
    role: "participant",
    institution: "kmitl",
    avatar: 1,
  },
  athlete: {
    id: "demo-athlete",
    name: "กฤษดา วงศ์ทอง",
    nickname: "ต้น",
    prefix: "นาย",
    role: "participant,athlete",
    institution: "kmutt",
    avatar: 2,
  },
  artStaff: {
    id: "demo-art-staff",
    name: "ชนิดา พรหมมา",
    nickname: "แพร",
    prefix: "นางสาว",
    role: "staff",
    department: "art",
    institution: "kmitl",
  },
  artHead: {
    id: "demo-art-head",
    name: "วรเมธ แสงอรุณ",
    nickname: "เมธ",
    prefix: "นาย",
    role: "staff",
    department: "art",
    seat: "head",
    institution: "kmitl",
  },
  techStaff: {
    id: "demo-tl-staff",
    name: "ณัฐวุฒิ คงเจริญ",
    nickname: "ณัฐ",
    prefix: "นาย",
    role: "staff",
    department: "tech-live",
    institution: "kmitl",
  },
  techHead: {
    id: "demo-tl-head",
    name: "สิรภพ อินทรสุวรรณ",
    nickname: "ภพ",
    prefix: "นาย",
    role: "staff",
    department: "tech-live",
    seat: "head",
    institution: "kmitl",
  },
  regStaff: {
    id: "demo-reg-staff",
    name: "พิมพ์ชนก รัตนวงศ์",
    nickname: "พิมพ์",
    prefix: "นางสาว",
    role: "staff",
    department: "registration",
    institution: "kmitl",
  },
  regOther: {
    id: "demo-reg-kmutt",
    name: "อรรถพล บุญมา",
    nickname: "พล",
    prefix: "นาย",
    role: "staff",
    department: "registration",
    institution: "kmutt",
  },
  regHead: {
    id: "demo-reg-head",
    name: "กมลชนก ทองดี",
    nickname: "กมล",
    prefix: "นางสาว",
    role: "staff",
    department: "registration",
    seat: "head",
    institution: "kmitl",
  },
  sportsStaff: {
    id: "demo-sports-staff",
    name: "ธนวัฒน์ เรืองศรี",
    nickname: "บอส",
    prefix: "นาย",
    role: "staff",
    department: "sports",
    institution: "kmitl",
  },
  // The head's seat is a name-only seat (OTHER_SEATS); this one is the vicehead.
  sportsHead: {
    id: "demo-sports-head",
    name: "กมลชนก ทองดี",
    nickname: "แพรว",
    prefix: "นางสาว",
    role: "staff",
    department: "sports",
    seat: "vicehead",
    institution: "kmitl",
  },
  admin: {
    id: "demo-admin",
    name: "ศุภชัย มั่นคง",
    nickname: "ชัย",
    prefix: "นาย",
    role: "admin",
    department: "tech-live",
    institution: "kmitl",
  },
} satisfies Record<string, Persona>;

export type PersonaKey = keyof typeof PERSONAS;

/** Athletes and participants who only fill the lists. */
export const CROWD: Persona[] = [
  ["demo-p01", "ภัทรพล สายทอง", "ภัทร", "นาย", "kmitl", 3],
  ["demo-p02", "ณิชา วัฒนกุล", "ณิชา", "นางสาว", "kmitl", 4],
  ["demo-p03", "ธีรภัทร ปานแก้ว", "ธีร์", "นาย", "kmitl", 5],
  ["demo-p04", "ศิริลักษณ์ ใจเย็น", "ฝน", "นางสาว", "kmutt", 6],
  ["demo-p05", "ปวริศ นาคสวัสดิ์", "ปอ", "นาย", "kmutt", 1],
  ["demo-p06", "จิรัชยา ทองคำ", "จิ๊บ", "นางสาว", "kmutnb-bangkok", 2],
  ["demo-p07", "กิตติพัฒน์ ศรีวงศ์", "กิต", "นาย", "kmutnb-bangkok", 3],
  ["demo-p08", "อัญชิสา เพชรรัตน์", "อัญ", "นางสาว", "kmutnb-prachinburi", 4],
  ["demo-p09", "วชิรวิทย์ แก้วมณี", "วิน", "นาย", "kmitl", 5],
  ["demo-p10", "รมิตา สุขประเสริฐ", "มิว", "นางสาว", "kmutt", 6],
].map(([id, name, nickname, prefix, institution, avatar]) => ({
  id: id as string,
  name: name as string,
  nickname: nickname as string,
  prefix: prefix as Persona["prefix"],
  role: "participant,athlete",
  institution: institution as Institution,
  avatar: avatar as number,
}));

/** Seats held by no demo account, so the leaders' page is not empty. Phones are fake. */
export const OTHER_SEATS: { department: string; role: "head" | "vicehead"; name: string; nickname: string; phone: string }[] = [
  { department: "art", role: "vicehead", name: "สุพิชญา อ่อนละมัย", nickname: "ใบเตย", phone: "0800000101" },
  { department: "tech-live", role: "vicehead", name: "ปิยะพงษ์ ดวงดี", nickname: "เปา", phone: "0800000102" },
  { department: "registration", role: "vicehead", name: "เบญญาภา ศรีทอง", nickname: "เบญ", phone: "0800000103" },
  { department: "pr", role: "head", name: "ศศิธร มีสุข", nickname: "ศศิ", phone: "0800000104" },
  { department: "pr", role: "vicehead", name: "ธนพล ใจกล้า", nickname: "ต้นกล้า", phone: "0800000105" },
  { department: "sports", role: "head", name: "อนุชา แข็งแรง", nickname: "ชา", phone: "0800000106" },
  { department: "medical", role: "head", name: "ชลธิชา รักษาดี", nickname: "ชล", phone: "0800000107" },
  { department: "venue", role: "head", name: "ภูริ ทองแท้", nickname: "ภู", phone: "0800000108" },
  { department: "finance", role: "head", name: "นภัสสร เงินดี", nickname: "นภ", phone: "0800000109" },
];

export const ALL_ACCOUNTS: Persona[] = [...Object.values(PERSONAS), ...CROWD];

export const SESSIONS_FILE = new URL("./.sessions.json", import.meta.url).pathname;
