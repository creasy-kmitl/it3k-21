# it3k esport bot

บอท Discord ของงาน esport (discordx บน Bun) ไม่มี database ของตัวเอง ข้อมูลทั้งหมดมาจาก `/api/bot/*` ของ apps/server

## ตั้งค่าครั้งแรก

1. สร้าง application ที่ https://discord.com/developers/applications → Bot → คัดลอก token และเปิด **Server Members Intent** (ใช้ทักคนเข้าใหม่)
2. เชิญบอทเข้า guild ด้วย scope `bot` และ `applications.commands` ให้สิทธิ์ **Administrator** (ง่ายสุด: ต้องสร้างยศ/ช่อง แบน และจัดการ thread) แล้วลากยศของบอทไว้**บนสุด** เพราะบอทให้ได้แค่ยศที่ต่ำกว่าตัวเอง
3. สร้าง `apps/discord/esport/.env` (ดูตัวแปรทั้งหมดใน `.env.schema`):
   ```
   DISCORD_BOT_TOKEN=...
   DISCORD_GUILD_ID=...
   BOT_API_TOKEN_DEV=it3kbot_...
   ```
4. ออก token ของบอทบนเว็บของแต่ละ stage: เข้าด้วยบัญชี admin → เมนู **เครื่องมือ → Bot token** (`/staff/bot-tokens`) → ออก token ใหม่ แล้วคัดลอกมาใส่ `BOT_API_TOKEN_DEV` / `BOT_API_TOKEN_STG` / `BOT_API_TOKEN_PROD` token แสดงครั้งเดียว server เก็บแค่ hash ถ้าหลุดให้กดเพิกถอนในหน้าเดียวกัน บอทจะโดนปฏิเสธ (401) ทันที แล้วออกอันใหม่

## รัน

```bash
bun run dev                                  # ที่ root: เปิด API ที่ :3000
bun run --cwd apps/discord/esport dev        # บอท (watch mode)
```

Docker (build จาก root ของ repo):

```bash
docker build -f apps/discord/esport/Dockerfile -t it3k-esport-bot .
docker run -d --env-file apps/discord/esport/.env -v esport-bot:/data it3k-esport-bot
```

## คำสั่ง

- `/ping` เช็กบอทและ API ของ mode ปัจจุบัน
- `/mode [env]` (Administrator เท่านั้น) ดูหรือสลับ API ระหว่าง dev / stg / prod บอทจะ ping ปลายทางก่อนสลับ ค่าที่เลือกเก็บใน SQLite (`SQLITE_PATH`) จึงอยู่ข้ามการรีสตาร์ท
- `/init` (Administrator เท่านั้น, **ใช้ได้ครั้งเดียว**) สร้างยศ หมวด ช่อง และข้อความปุ่มตาม `src/lib/layout.ts` แล้วเก็บ ID ไว้ใน SQLite พอสำเร็จบอทจะลบคำสั่ง `/init` ออกจาก guild ถ้ามีอะไรพลาด คำสั่งยังอยู่ให้แก้แล้วรันซ้ำได้ (ของที่สร้างแล้วจะไม่ถูกสร้างซ้ำ)

ลำดับแนะนำ: `/mode` เลือก API ให้ถูกก่อน → `/init` → เชื่อม Discord ที่หน้าโปรไฟล์บนเว็บ → กดปุ่มรับยศในช่อง verify

### รัน `/init` ใหม่

```bash
bun run --cwd apps/discord/esport init:reset
```

(ใน Docker: `docker exec <container> bun run init:reset`) แล้วรีสตาร์ทบอท `/init` จะกลับมา รันใหม่จะใช้ของเดิมที่ยังอยู่ สร้างเฉพาะที่หายไป และตั้งสิทธิ์ของทุกช่องใหม่ให้ตรง layout (ไม่เปลี่ยนชื่อช่องที่แอดมินแก้เอง)

## ระบบในเซิร์ฟเวอร์

- **รับยศ (verify):** ปุ่มในช่อง verify ถาม `/api/bot/members/<discord id>` แล้วให้ยศตามข้อมูลใน it3k: `🛠️ Staff` (บัญชี staff/admin), ยศเกม (`⚔️ ROV` …) และยศทีม `ROV · สจล.` จากการสมัคร Esports ที่ได้รับอนุมัติ พร้อมตั้งชื่อในเซิร์ฟเวอร์ตาม `src/lib/nickname.ts` (นักกีฬา `[มจธ.] <IGN>`, ทีมงาน `[Staff] <ชื่อเล่น>`, คนอื่น `[สถาบัน] <ชื่อเล่น>`; ไม่มีชื่อเล่นหรือ IGN บนเว็บจะไม่เปลี่ยนชื่อ) แล้วตอบเป็น embed สรุปสถาบัน รายการแข่ง ยศ และชื่อที่ตั้ง กดซ้ำเพื่ออัปเดต บอทถอดเฉพาะยศที่ตัวเองสร้าง Discord ไม่ให้บอทเปลี่ยนชื่อเจ้าของเซิร์ฟเวอร์หรือคนที่ยศสูงกว่าบอท เกมจับคู่กับ division ด้วย `GAMES` ใน `src/lib/games.ts` (division ที่ไม่ตรงเกมไหนจะไม่ได้ยศ)
- **ห้องทีม:** แบ่งตามสถาบัน (1 ทีม = ตัวแทน 1 สถาบัน) เห็นเฉพาะยศทีมนั้นกับ Staff
- **ticket:** ปุ่มในช่อง ticket เปิด private thread ที่เห็นแค่ผู้แจ้งกับ Staff ปิดได้โดยผู้แจ้งหรือ Staff
- **honeypot:** ใครพิมพ์ในช่อง `🍯・honeypot` จะโดน softban (แบน + ลบข้อความ 24 ชม. แล้วปลดแบน) ยกเว้น Staff และคนที่มีสิทธิ์ Manage Messages log ส่งไปที่ `💼・คุยงาน`
- **คนเข้าใหม่:** บอททักในช่อง new-member และชี้ไปช่อง verify ถ้าเชื่อม Discord บนเว็บไว้แล้ว บอทให้ยศและตั้งชื่อให้ทันทีโดยไม่ต้องกดปุ่ม

## เพิ่มคำสั่งใหม่

สร้างไฟล์ใน `src/modules/<ชื่อ>/` เป็น class ที่มี `@Discord()` และ `@Slash()` (หรือ `@ButtonComponent`, `@On`) แล้ว importx จะโหลดให้เอง ชื่อหมวด/ช่อง/ยศแก้ที่ `src/lib/layout.ts` ที่เดียว ถ้าต้องการข้อมูลใหม่จาก server ให้เพิ่ม route ใน `apps/server/src/routes/bot/index.ts` แล้วเรียกผ่าน `api()` จาก `src/lib/context.ts` (type ตามมาเอง) อย่าวางไฟล์ test ไว้ใน `src/modules/`
