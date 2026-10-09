import { listTestUsers } from "@/modules/identity/test-identity";

export const dynamic = "force-dynamic";

export const GET = () => listTestUsers();
