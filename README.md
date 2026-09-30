![ภาพประกอบทีมงาน IT3K สองคน](docs/assets/it3k-mascots-banner.png)

# IT·3·Kings (IT3K)

**ระบบจัดการงานสำหรับทีมงาน IT3K** มหกรรมกีฬาสานสัมพันธ์ของนักศึกษาด้านเทคโนโลยีสารสนเทศจากสามสถาบันพระจอมเกล้า: มจธ., มจพ. และ สจล.

Staff portal for the IT·3·Kings sports event, connecting IT students from KMUTT, KMUTNB and KMITL.

[เข้าสู่เว็บไซต์](https://it3k.creasy.club) · [เริ่มพัฒนา](#เริ่มพัฒนาในเครื่อง) · [คู่มือนักพัฒนา](docs/development.md)

## เกี่ยวกับโปรเจกต์

<img src="docs/assets/it3k-mascot.png" alt="ภาพประกอบมาสคอตทีมงาน IT3K" width="112" align="right">

แอปนี้ช่วยให้ทีมงานจัดการฝ่าย ผู้รับผิดชอบ และปฏิทินกิจกรรมร่วมกัน หน้าจอใช้งานเป็นภาษาไทย เข้าสู่ระบบด้วย Google; บัญชีใหม่เริ่มต้นเป็น `guest` และต้องได้รับสิทธิ์จากทีมงานก่อนเข้าใช้ส่วน `/staff`.

- **ฝ่ายและสมาชิก:** ผู้ดูแลระบบสร้างและแก้ไขฝ่าย พร้อมจัดสมาชิกเข้าฝ่าย
- **หัวหน้าและรองหัวหน้า:** จัดการตำแหน่งประจำฝ่ายและดูข้อมูลติดต่อเมื่อมีสิทธิ์
- **บัญชีผู้ใช้:** ผู้จัดการค้นหาและกำหนดบทบาทของสมาชิก; เฉพาะผู้ดูแลระบบเท่านั้นที่ให้สิทธิ์ `admin` ได้
- **ปฏิทินทีมงาน:** วางแผนงานของแต่ละฝ่าย เพิ่มฝ่ายที่ร่วมงาน รับการแจ้งเตือน และเพิ่มกิจกรรมลง Google, Apple หรือ Microsoft Calendar ได้

## เริ่มพัฒนาในเครื่อง

ต้องมี [Bun 1.4.2](https://bun.sh), บัญชี Cloudflare และ Axiom สำหรับ Alchemy และ Google OAuth client ที่เพิ่ม redirect URI `http://localhost:3000/api/auth/callback/google` แล้ว ดูรายละเอียดการตั้งค่าได้ใน[คู่มือนักพัฒนา](docs/development.md#getting-started).

1. ติดตั้ง dependencies จากรากของ repository:

   ```bash
   bun install --frozen-lockfile
   ```

2. ตั้งค่า Alchemy profile และสร้าง `apps/server/.env` โดยกำหนด `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET_ID` และ `OAUTH_PROXY_SECRET` ตามคำอธิบายใน [`apps/server/.env.schema`](apps/server/.env.schema):

   ```bash
   cd packages/infra && bunx alchemy profile edit
   cd ../..
   ```

3. เริ่ม web และ API พร้อมฐานข้อมูล D1 ในเครื่อง:

   ```bash
   bun run dev
   ```

เปิดเว็บที่ [localhost:3001](http://localhost:3001) และ API ที่ [localhost:3000](http://localhost:3000) การเริ่มครั้งแรกจะใช้ migrations ที่มีอยู่ บัญชีที่เพิ่งเข้าสู่ระบบยังเป็น `guest`; ขั้นตอนตั้งผู้ดูแลระบบคนแรกอยู่ใน[คู่มือนักพัฒนา](docs/development.md#becoming-an-admin).

> เปิด `alchemy dev` เพียงครั้งเดียวในเวลาเดียวกัน เพราะการเปิดซ้ำอาจเปลี่ยน `VITE_SERVER_URL` ไปเป็นพอร์ต `3002`.

## โครงสร้าง repository

```text
apps/
  web/       เว็บไซต์ TanStack Start และหน้า /staff
  server/    Hono API, การยืนยันสิทธิ์ และนโยบายการเข้าถึง
packages/
  auth/      Better Auth และบทบาทผู้ใช้
  db/        Drizzle schema, migrations และฐานข้อมูลสำหรับทดสอบ
  ui/        คอมโพเนนต์ shadcn/ui ที่ใช้ร่วมกัน
  infra/     Alchemy stack สำหรับ Workers, D1 และบริการที่เกี่ยวข้อง
  config/    TypeScript config ที่ใช้ร่วมกัน
```

## เทคโนโลยีหลัก

| ส่วน | เทคโนโลยี |
| --- | --- |
| เว็บ | TanStack Start, React 19, TanStack Router และ Query, Tailwind CSS |
| API และบัญชี | Hono, Better Auth, Zod |
| ข้อมูลและโครงสร้างพื้นฐาน | Cloudflare Workers, D1, Drizzle, Alchemy |
| เครื่องมือพัฒนา | Bun workspaces, Vite+ (`vp`), Biome |

เว็บและ API ทำงานบน Cloudflare Workers คนละตัว รายละเอียดการออกแบบ API, สิทธิ์, migrations และ deployment อยู่ใน[คู่มือนักพัฒนา](docs/development.md).

## ตรวจสอบการเปลี่ยนแปลง

รันคำสั่งจากรากของ repository:

```bash
bun test
bun run lint
bun run lint:biome
bun run check-types
```

เปิด pull request ไปที่ `main` เพื่อส่งการเปลี่ยนแปลง ดู conventions และขั้นตอน deployment ใน[คู่มือนักพัฒนา](docs/development.md#contributing).
