/**
 * Environment bindings for Cloudflare Workers.
 * This is a simplified type for the agents package - the full type
 * with DurableObjectNamespace bindings is in @panelai/worker.
 */
interface Env {
  OPENAI_API_KEY: string;
  AI: Ai;
  Chat: DurableObjectNamespace;
}
