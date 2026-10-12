// Runs once when the Next.js server starts (not during `next build`). An unsafe configuration stops the process
// before it serves any request (Gate A2, L2). The check itself is Node.js-only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { checkRuntimeConfigOrExit } = await import("./instrumentation-node");
  checkRuntimeConfigOrExit();
}
