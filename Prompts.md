# AI Prompts Used in Development

This document captures the key prompts used with Claude to build the Jarvis AI Assistant. Main issue is that it makes syntax errors which requires to fix them properly.

---

## 1. Initial Architecture & Planning

**Prompt:**

> I want to build a voice-enabled AI assistant using Cloudflare's platform. Requirements: LLM + Workflow/Coordination + User Input (chat/voice) + Memory/State. What architecture would you recommend?

**Outcome:** Decided on multi-agent orchestrator pattern with:

- Jarvis as main agent with personality
- Voice: Whisper (STT) → Llama 3.3 70B → Deepgram Aura (TTS)
- State: Durable Objects with SQLite
- 100% Cloudflare stack

---

## 2. Project Setup

**Prompt:**

> How do I setup a Cloudflare Agents project?

**Outcome:** Used the agents-starter template:

```bash
npm create cloudflare@latest cf_ai_jarvis -- --template=cloudflare/agents-starter
```

---

## 3. Switching from OpenAI to Workers AI

**Prompt:**

> The template uses OpenAI but I want to use Cloudflare's free Workers AI models instead. How do I switch to Ollama?

**Outcome:** Replaced OpenAI SDK with workers-ai-provider:

```typescript
import { createWorkersAI } from "workers-ai-provider";
const workersAI = createWorkersAI({ binding: this.env.AI });
const model = workersAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
```

---

## 4. Jarvis Personality

**Prompt:**

> Give Jarvis a personality like Iron Man's AI. Make it professional but warm, addresses user as "sir", helpful with a bit of wit.

**Outcome:** Created system prompt:

```
You are Jarvis, a personal AI assistant.
- Address the user as "sir" or by name once you know it
- Warm, friendly, professional - a trusted companion
- Direct and helpful with a good sense of humor
```

---

## 5. Voice Input Implementation

**Prompt:**

> How do I add voice input using Whisper? I want the user to click a mic button, speak, and have it transcribed and sent.

**Outcome:** Added `/transcribe` endpoint using Whisper and MediaRecorder API in React.

---

## 6. Auto-Stop on Silence

**Prompt:**

> There's latency for Whisper. Can we auto-stop recording after 2-3 seconds of silence instead of requiring a button click?

**Outcome:** Implemented Web Audio API silence detection:

```typescript
const analyser = audioContext.createAnalyser();
// Monitor audio levels, stop when silent for 2 seconds
```

---

## 7. Voice Output (TTS)

**Prompt:**

> Now let's add voice output so Jarvis can talk back. What TTS options does Cloudflare have?

**Outcome:** Initially tried MeloTTS, then switched to Deepgram Aura for better voice quality and speaker options.

---

## 8. Choosing a Voice

**Prompt:**

> Is there any way we can change the voice? MeloTTS sounds robotic.

**Outcome:** Switched to Deepgram Aura with `speaker: "arcas"` for a warm, friendly male voice.

---

## 9. Memory Implementation

**Prompt:**

> Add memory/state so Jarvis remembers things about the user across conversations.

**Outcome:** Implemented SQLite memory using Durable Objects:

- `saveMemory(key, value)` - Store facts
- `getMemories()` - Retrieve all memories
- Memory injection into system prompt
- Pattern-based extraction: `[MEMORY: key=value]`

---

## 10. Tool Calling Issues

**Prompt:**

> The model keeps calling tools even for simple greetings like "Hello". How do I make it less eager?

**Attempted Solutions:**

1. Added explicit "DO NOT use tools for greetings" instructions
2. Tried `toolChoice: "auto"`
3. Added detailed TOOL USAGE RULES

**Outcome:** Llama 3.3 70B remained too tool-eager. Decided to comment out tools and focus on core features.

---

## 11. UI Polish

**Prompt:**

> Jarvis has blue color right (like in the movies)? Let's make the UI blue as well.

**Outcome:** Changed accent color from orange `#F48120` to Jarvis blue `#0EA5E9` throughout the UI.

---

## 12. Typing Indicator

**Prompt:**

> Add a typing indicator when Jarvis is thinking. sounds cool.

**Outcome:** Added bouncing dots animation when `status === "streaming"`:

```tsx
<div className="w-2 h-2 bg-[#0EA5E9] rounded-full animate-bounce" />
```

---

## 13. Architecture Diagram

**Prompt:**

> For the architecture, let's use Mermaid to show the diagram. Show what we're using. Make it technical but simple enough that anyone can understand.

**Outcome:** Created Mermaid flowchart showing Input → Cloudflare Workers AI → Output with component details.

---

## Key Learnings

1. **Start with a template** - Cloudflare's agents-starter saved setup time
2. **Iterate quickly** - Test each feature before moving to the next
3. **Simplify when stuck** - Commented out tools rather than fighting the model
4. **Use the right model** - Deepgram Aura >> MeloTTS for voice quality
5. **Pattern-based extraction** - `[MEMORY: key=value]` makes parsing reliable

---

## Tools & Models Used

| Purpose               | Technology                |
| --------------------- | ------------------------- |
| Development Assistant | Claude (Anthropic)        |
| LLM                   | Llama 3.3 70B             |
| Speech-to-Text        | Whisper                   |
| Text-to-Speech        | Deepgram Aura             |
| State Management      | SQLite in Durable Objects |
