import { describe, expect, it } from "vitest";
import { SharedMemoryClient } from "./shared-memory.js";

type Store = Map<string, unknown>;

function createSharedMemoryStub(store: Store): DurableObjectStub {
  const read = (scope: string, key: string) => store.get(`${scope}::${key}`);
  const write = (scope: string, key: string, value: unknown) =>
    store.set(`${scope}::${key}`, value);

  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === "/set" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          scope: string;
          key: string;
          value: unknown;
        };
        write(body.scope, body.key, body.value);
        return Response.json({ success: true });
      }

      if (url.pathname === "/get" && init?.method === "GET") {
        const scope = url.searchParams.get("scope") ?? "global";
        const key = url.searchParams.get("key");
        if (!key) return new Response("Missing key", { status: 400 });
        const value = read(scope, key);
        if (value === undefined) return Response.json(null);
        return Response.json({
          key,
          value,
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: "agent"
          }
        });
      }

      if (url.pathname === "/add-topic-covered" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          interviewId: string;
          topic: string;
        };
        const scope = `interview:${body.interviewId}`;
        const topics =
          (read(scope, "topicsCovered") as string[] | undefined) ?? [];
        if (!topics.includes(body.topic)) topics.push(body.topic);
        write(scope, "topicsCovered", topics);
        return Response.json({ success: true });
      }

      if (url.pathname === "/add-question-asked" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          interviewId: string;
          question: string;
          agentId?: string;
        };
        const scope = `interview:${body.interviewId}`;
        const list =
          (read(scope, "questionsAsked") as
            | Array<{ question: string; askedBy: string }>
            | undefined) ?? [];
        list.push({
          question: body.question,
          askedBy: body.agentId ?? "unknown"
        });
        write(scope, "questionsAsked", list);
        return Response.json({ success: true });
      }

      if (url.pathname === "/add-key-point" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          interviewId: string;
          point: string;
          agentId: string;
        };
        const scope = `interview:${body.interviewId}`;
        const list =
          (read(scope, "keyPoints") as
            | Array<{ point: string; addedBy: string }>
            | undefined) ?? [];
        list.push({ point: body.point, addedBy: body.agentId });
        write(scope, "keyPoints", list);
        return Response.json({ success: true });
      }

      return new Response("Not Found", { status: 404 });
    }
  } as unknown as DurableObjectStub;
}

describe("shared-memory integration", () => {
  it("shares interview context between two clients", async () => {
    const store: Store = new Map();
    const stub = createSharedMemoryStub(store);
    const clientA = new SharedMemoryClient(stub);
    const clientB = new SharedMemoryClient(stub);

    await clientA.setScoped("interview:iv-1", "candidateProfile", {
      name: "Alex"
    });
    await clientA.addTopicCovered("iv-1", "system-design");
    await clientB.addQuestionAsked(
      "iv-1",
      "How would you scale this?",
      "technical-1"
    );
    await clientB.addKeyPoint(
      "iv-1",
      "Strong tradeoff reasoning",
      "technical-1"
    );

    const candidate = await clientB.getScoped<{ name: string }>(
      "interview:iv-1",
      "candidateProfile"
    );
    const topics = await clientB.getScoped<string[]>(
      "interview:iv-1",
      "topicsCovered"
    );
    const questions = await clientA.getScoped<
      Array<{ question: string; askedBy: string }>
    >("interview:iv-1", "questionsAsked");
    const keyPoints = await clientA.getScoped<
      Array<{ point: string; addedBy: string }>
    >("interview:iv-1", "keyPoints");

    expect(candidate?.value).toEqual({ name: "Alex" });
    expect(topics?.value).toEqual(["system-design"]);
    expect(questions?.value[0]?.question).toBe("How would you scale this?");
    expect(keyPoints?.value[0]?.point).toBe("Strong tradeoff reasoning");
  });
});
