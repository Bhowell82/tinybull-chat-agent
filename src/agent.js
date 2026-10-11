import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "./config.js";
import { buildSystemPrompt } from "./prompt.js";

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: cfg.anthropicKey });
  return client;
}

const respondTool = {
  name: "respond",
  description: "Reply to the website visitor and record your internal lead assessment.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The message to send the visitor. Short, natural, one question at most. Empty string only if no reply should be sent (for example the visitor just said thanks and the chat is done).",
      },
      lead_score: {
        type: "string",
        enum: ["hot", "warm", "cold", "spam", "not_a_lead"],
      },
      handoff: {
        type: "boolean",
        description: "True if a human should take over now (hot lead, asked for a person, upset, existing client issue, or you are unsure).",
      },
      handoff_reason: { type: "string", description: "One short line. Empty if no handoff." },
      summary: {
        type: "string",
        description: "Two or three lines for the team: who they are, what they need, budget/timeline if known, and the suggested next step.",
      },
      captured: {
        type: "object",
        description: "Details learned so far. Use empty strings for unknown.",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          business: { type: "string" },
          location: { type: "string" },
          need: { type: "string" },
          budget: { type: "string" },
          timeline: { type: "string" },
        },
      },
    },
    required: ["reply", "lead_score", "handoff", "handoff_reason", "summary", "captured"],
  },
};

export async function decide(chat) {
  if (cfg.mock) {
    return {
      reply: "Yep, Google Ads cleanup is a big part of what we do. What kind of results are you getting from them right now?",
      lead_score: "warm",
      handoff: false,
      handoff_reason: "",
      summary: "HVAC company in Roanoke, Google Ads underperforming. Need qualified; no budget yet.",
      captured: { name: "Dana", email: "", phone: "", business: "HVAC company", location: "Roanoke", need: "Google Ads fix", budget: "", timeline: "" },
    };
  }

  const turns = toClaudeTurns(chat.messages);
  const res = await getClient().messages.create({
    model: cfg.model,
    max_tokens: 700,
    system: buildSystemPrompt(cfg),
    tools: [respondTool],
    tool_choice: { type: "tool", name: "respond" },
    messages: turns,
  });

  const block = res.content.find((b) => b.type === "tool_use" && b.name === "respond");
  if (!block) throw new Error("Claude returned no respond tool call");
  return block.input;
}

// Claude needs alternating roles starting with "user". Visitor = user, team/bot = assistant.
function toClaudeTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const role = m.role === "visitor" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += `\n${m.text}`;
    } else {
      turns.push({ role, content: m.text });
    }
  }
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "(visitor opened the chat)" });
  }
  // The last turn must be the visitor's
  if (turns[turns.length - 1].role !== "user") {
    turns.push({ role: "user", content: "(visitor is waiting)" });
  }
  return turns;
}
