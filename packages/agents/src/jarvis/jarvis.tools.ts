/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./jarvis.agent.js";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description:
    "Get the current weather for a city. ONLY call this tool if the user's message contains the words 'weather' AND a city name. Do NOT call for any other reason.",
  inputSchema: z.object({
    city: z.string().describe("The city name to get weather for")
  })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description:
    "Get the current local time in a location. ONLY call this tool if the user's message explicitly asks 'what time is it in [place]'. Do NOT call for any other reason.",
  inputSchema: z.object({
    location: z.string().describe("The location to get time for")
  }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    const now = new Date();
    return `The current time in ${location} is approximately ${now.toLocaleTimeString()}`;
  }
});

const scheduleTask = tool({
  description:
    "Schedule a reminder or task for the future. ONLY call this tool if the user's message contains 'remind me', 'schedule', 'set a reminder', or 'in X minutes/hours'. Do NOT call for any other reason.",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description:
    "List all pending reminders and scheduled tasks. ONLY call this tool if the user's message explicitly asks to see tasks or reminders. Do NOT call for any other reason.",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return `You have ${tasks.length} scheduled task(s): ${JSON.stringify(tasks)}`;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description:
    "Cancel a scheduled reminder or task. ONLY call this tool if the user's message explicitly says to cancel a specific task. Do NOT call for any other reason.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Done! I've canceled that task.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Sorry, I couldn't cancel that task: ${error}`;
    }
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
};
