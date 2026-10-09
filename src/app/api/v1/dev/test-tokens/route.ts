import { issueTestToken } from "@/modules/identity/test-identity";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => issueTestToken(req);
