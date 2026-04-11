/**
 * Environment bindings for Cloudflare Workers.
 * This is a simplified type for the agents package - the full type
 * with DurableObjectNamespace bindings is in @panelai/worker.
 */
interface Env {
  AI: Ai;
  AI_PROVIDER?: "workers-ai" | "openai-compatible";
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  Chat: DurableObjectNamespace;
}
