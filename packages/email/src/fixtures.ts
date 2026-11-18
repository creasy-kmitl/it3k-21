import type { EmailContext } from "./components/layout";
import type {
  CustomEmail,
  InvitationJob,
  ProfileSubmittedJob,
  SportRegisteredJob,
  SportReviewedJob,
  TicketClaimedJob,
} from "./jobs";

/** Sample data for the preview server (`bun run email:dev`) and the tests. */
export const sampleContext: EmailContext = {
  webOrigin: "http://localhost:3001",
  apiOrigin: "http://localhost:3000",
};

const to = { email: "somchai@example.com", name: "สมชาย" };

export const sampleProfileSubmitted: ProfileSubmittedJob = {
  kind: "profile-submitted",
  to,
  profile: {
    prefix: "นาย",
    firstName: "สมชาย",
    lastName: "ใจดี",
    nickname: "ชาย",
    phone: "0812345678",
    institution: "kmitl",
    medicalConditions: "หอบหืด",
    drugAllergies: "",
    foodAllergies: "กุ้ง",
    dietaryRestrictions: "",
  },
};

export const sampleSportRegistered: SportRegisteredJob = {
  kind: "sport-registered",
  to,
  registration: {
    sport: "ฟุตบอล",
    division: "ฟุตบอลชาย",
    gender: "male",
    format: "team",
    institution: "kmitl",
    status: "review",
    shirtNumber: 10,
    badmintonRank: null,
    ign: null,
  },
};

export const sampleSportApproved: SportReviewedJob = {
  kind: "sport-reviewed",
  to,
  registration: {
    sport: "ฟุตบอล",
    division: "ฟุตบอลชาย",
    institution: "kmitl",
    status: "approved",
    note: null,
  },
};

export const sampleSportRejected: SportReviewedJob = {
  kind: "sport-reviewed",
  to,
  registration: {
    sport: "แบดมินตัน",
    division: "เดี่ยวชาย",
    institution: "kmutt",
    status: "rejected",
    note: "รหัสนักศึกษาไม่ตรงกับบัตร กรุณาติดต่อฝ่ายทะเบียน",
  },
};

export const sampleTicketClaimed: TicketClaimedJob = {
  kind: "ticket-claimed",
  to,
  ticket: {
    ref: "opening-ceremony",
    eventName: "พิธีเปิด IT3Kings",
    startAt: Date.UTC(2026, 11, 5, 10, 0),
    endAt: Date.UTC(2026, 11, 5, 12, 30),
    venue: "หอประชุมเจ้าพระยาสุรวงษ์ไวยวัฒน์",
    code: "Zx3sQm9vT2kLp8RwYb4NcHd7Ue1Fa6Jg",
  },
};

export const sampleInvitation: InvitationJob = {
  kind: "invitation",
  to: { email: "friend@gmail.com" },
  invite: {
    kind: "staff",
    department: "Tech/Live",
    institution: "kmutnb-bangkok",
    invitedBy: "สมชาย ใจดี",
    expiresAt: Date.UTC(2026, 11, 2, 3, 0),
  },
};

export const sampleCustom: CustomEmail = {
  kind: "custom",
  to,
  subject: "นัดซ้อมพิธีเปิด วันเสาร์นี้",
  sender: "ฝ่าย Tech/Live",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "สวัสดีนักกีฬาทุกคน " },
          { type: "text", text: "นัดซ้อมพิธีเปิด", marks: [{ type: "bold" }] },
          { type: "text", text: " วันเสาร์นี้ 09:00 น." },
        ],
      },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "สิ่งที่ต้องเตรียม" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "ชุดกีฬาของสถาบัน" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "บัตรนักศึกษา" }] }],
          },
        ],
      },
      {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "มาก่อนเวลา 15 นาที", marks: [{ type: "italic" }] }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "รายละเอียดเพิ่มเติมที่ " },
          {
            type: "text",
            text: "หน้ากิจกรรม",
            marks: [{ type: "link", attrs: { href: "http://localhost:3001/events" } }],
          },
        ],
      },
    ],
  },
};
