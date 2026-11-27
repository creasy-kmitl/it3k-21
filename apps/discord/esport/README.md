# it3k esport bot

บอท Discord ของงาน esport (discordx บน Bun) ไม่มี database ของตัวเอง ข้อมูลทั้งหมดมาจาก `/api/bot/*` ของ apps/server

## ตั้งค่าครั้งแรก

1. สร้าง application ที่ https://discord.com/developers/applications → Bot → คัดลอก token
2. เชิญบอทเข้า guild ด้วย scope `bot` และ `applications.commands`
3. สร้าง `apps/discord/esport/.env` (ดูตัวแปรทั้งหมดใน `.env.schema`):
   ```
   DISCORD_BOT_TOKEN=...
   DISCORD_GUILD_ID=...
   BOT_API_TOKEN_DEV=<ค่าเดียวกับ BOT_API_TOKEN ใน apps/server/.env>
   ```
   สร้าง token ด้วย `openssl rand -hex 32`
4. staging/prod: ตั้ง GitHub secret `BOT_API_TOKEN_STAGING` / `BOT_API_TOKEN_PROD` แล้ว deploy ใหม่ และใส่ค่าเดียวกันใน `BOT_API_TOKEN_STG` / `BOT_API_TOKEN_PROD` ของบอท

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

## เพิ่มคำสั่งใหม่

สร้างไฟล์ใน `src/modules/<ชื่อ>/` เป็น class ที่มี `@Discord()` และ `@Slash()` แล้ว importx จะโหลดให้เอง ถ้าต้องการข้อมูลใหม่จาก server ให้เพิ่ม route ใน `apps/server/src/routes/bot/index.ts` แล้วเรียกผ่าน `api()` จาก `src/lib/context.ts` (type ตามมาเอง) อย่าวางไฟล์ test ไว้ใน `src/modules/`
