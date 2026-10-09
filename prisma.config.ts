import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migration chạy bằng chủ sở hữu schema; ứng dụng dùng DATABASE_URL (hrms_app) qua driver adapter.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.MIGRATION_DATABASE_URL },
});
