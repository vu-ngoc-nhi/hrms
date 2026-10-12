import { unsafeRuntimeConfig } from "@/lib/config";

export function checkRuntimeConfigOrExit() {
  const problems = unsafeRuntimeConfig(process.env);
  if (!problems.length) return;
  console.error(JSON.stringify({ level: "fatal", event: "unsafe_runtime_configuration", problems }));
  process.exit(1);
}
