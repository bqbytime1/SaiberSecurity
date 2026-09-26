import path from "node:path";
import { defineConfig } from "@prisma/config";

// Once a Prisma config file exists, the CLI stops loading .env on its own, so do it here.
// Values already present in the real environment win, which is what deployments expect.
const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile;
try {
  loadEnvFile?.(path.join(process.cwd(), ".env"));
} catch {
  // .env is optional — DATABASE_URL may be supplied by the environment instead.
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
