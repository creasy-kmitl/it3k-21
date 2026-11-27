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
4. **พาคนเข้าเซิร์ฟเวอร์อัตโนมัติ:** เว็บต้องใช้ application เดียวกับบอทสำหรับเชื่อม Discord เพราะ Discord ให้แค่บอทของ app ที่ออก token พาคนเข้า guild ได้ (scope `guilds.join`)
   - ใน Developer Portal ของ app บอท → OAuth2 → Redirects เพิ่ม `<BETTER_AUTH_URL>/api/auth/callback/discord` ของทุก stage (localhost, staging, prod)
   - ตั้ง secret ของ repo `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` เป็นของ app บอท และ `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` ค่าเดียวกับ `.env` ของบอท (local: `apps/server/.env`)
   - พอเชื่อม Discord บนเว็บ server ใช้ token ของคนนั้นพาเข้า guild ทันที (เฉพาะทีมงานฝ่ายกีฬา/Tech และผู้สมัคร Esports) แล้วบอทให้ยศและตั้งชื่อตอนเห็นคนเข้า (`guildMemberAdd`) ถ้าว่าง server จะข้ามขั้นนี้
5. ออก token ของบอทบนเว็บของแต่ละ stage: เข้าด้วยบัญชี admin → เมนู **เครื่องมือ → Bot token** (`/staff/bot-tokens`) → ออก token ใหม่ แล้วคัดลอกมาใส่ `BOT_API_TOKEN_DEV` / `BOT_API_TOKEN_STG` / `BOT_API_TOKEN_PROD` token แสดงครั้งเดียว server เก็บแค่ hash ถ้าหลุดให้กดเพิกถอนในหน้าเดียวกัน บอทจะโดนปฏิเสธ (401) ทันที แล้วออกอันใหม่

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

## Deploy

บอทมีตัวเดียว รันบน VM ที่ไม่มี public IP (`suwizx@100.96.0.14` ผ่าน Cloudflare mesh) จึงใช้แบบให้ VM ดึงเอง:

1. merge เข้า `main` → workflow `.github/workflows/discord-bot.yml` รันเทสต์บอท แล้ว build image ขึ้น `ghcr.io/creasy-kmitl/it3k-esport-bot` (tag `latest` และ `sha-<commit>`) ส่วน PR แค่ build ตรวจ ไม่ push
2. บน VM, `it3k-esport-bot-update.timer` (systemd user timer) รัน `~/it3k-esport-bot/update.sh` ทุก 1 นาที: `docker compose pull` แล้ว `up -d` ซึ่งรีสตาร์ทบอทเฉพาะตอน image เปลี่ยน

CI ไม่ต้องเข้าถึง VM และไม่ถือ secret ของบอท: `.env` อยู่บน VM ที่เดียว ข้อมูล SQLite (mode, ID จาก `/init`) อยู่ใน volume `it3k-esport-bot_data`

ไฟล์ฝั่ง VM อยู่ใน `deploy/` ติดตั้งครั้งแรก:

```bash
scp apps/discord/esport/deploy/{compose.yaml,update.sh} suwizx@100.96.0.14:it3k-esport-bot/
scp apps/discord/esport/deploy/it3k-esport-bot-update.{service,timer} suwizx@100.96.0.14:.config/systemd/user/
ssh suwizx@100.96.0.14 'systemctl --user daemon-reload && systemctl --user enable --now it3k-esport-bot-update.timer'
```

แล้ววาง `.env` ที่ `~/it3k-esport-bot/.env` (ไม่มีไฟล์นี้ timer จะไม่ทำอะไร) ดู log: `journalctl --user -u it3k-esport-bot-update -f` และ `docker compose -f ~/it3k-esport-bot/compose.yaml logs -f`

ย้อนเวอร์ชัน: แก้ `image:` ใน `compose.yaml` บน VM เป็น `:sha-<commit>` แล้ว `docker compose up -d` (กลับเป็น `:latest` เมื่อแก้เสร็จ)

**รันบอทได้ทีละที่เท่านั้น:** token เดียวกันรันสองที่ ทั้งสองจะรับ interaction ซ้ำกัน ก่อนรันบน local ให้หยุดบน VM ก่อน (`docker compose -f ~/it3k-esport-bot/compose.yaml stop`)

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
- **พาเข้าเซิร์ฟเวอร์:** เชื่อม Discord บนเว็บแล้ว server พาเข้าเซิร์ฟเวอร์ให้เลย (`packages/auth` `onDiscordLinked` → `apps/server/src/services.ts`) บัญชีที่เชื่อมไว้ก่อนมี `guilds.join` กด **เข้าเซิร์ฟเวอร์ Discord** ที่ `/me` แล้ว Discord จะขออนุญาตอีกครั้ง
- **คนเข้าใหม่:** บอททักในช่อง new-member และชี้ไปช่อง verify ถ้าเชื่อม Discord บนเว็บไว้แล้ว บอทให้ยศและตั้งชื่อให้ทันทีโดยไม่ต้องกดปุ่ม

## เพิ่มคำสั่งใหม่

สร้างไฟล์ใน `src/modules/<ชื่อ>/` เป็น class ที่มี `@Discord()` และ `@Slash()` (หรือ `@ButtonComponent`, `@On`) แล้ว importx จะโหลดให้เอง ชื่อหมวด/ช่อง/ยศแก้ที่ `src/lib/layout.ts` ที่เดียว ถ้าต้องการข้อมูลใหม่จาก server ให้เพิ่ม route ใน `apps/server/src/routes/bot/index.ts` แล้วเรียกผ่าน `api()` จาก `src/lib/context.ts` (type ตามมาเอง) อย่าวางไฟล์ test ไว้ใน `src/modules/`
