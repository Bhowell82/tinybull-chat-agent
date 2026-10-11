import express from "express";
import { cfg, assertConfig } from "./config.js";
import { getChat, sendMessage, tagThread } from "./livechat.js";
import { decide } from "./agent.js";

assertConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));

const timers = new Map(); // chatId -> debounce timer
const inFlight = new Set(); // chatIds currently being processed
const lastHandled = new Map(); // chatId -> id of last visitor event we answered
const handedOff = new Set(); // chatIds where a human was pinged, bot stays quiet in auto mode

app.get("/", (_req, res) => res.send("tinybull-chat-agent ok"));
app.get("/health", (_req, res) => res.json({ ok: true, mode: cfg.mode, mock: cfg.mock }));

app.post("/webhook/livechat", (req, res) => {
  const body = req.body || {};

  if (!cfg.mock && body.secret_key !== cfg.lc.webhookSecret) {
    return res.status(401).json({ error: "bad secret" });
  }

  // Acknowledge fast; do the work async.
  res.status(200).json({ ok: true });

  if (body.action !== "incoming_event") return;
  const p = body.payload || {};
  const ev = p.event || {};
  if (ev.type !== "message" || !ev.text) return;
  if (ev.visibility && ev.visibility !== "all") return; // ignore private notes

  const chatId = p.chat_id;
  if (!chatId) return;

  // Only react to visitor messages. LiveChat tags the author; customers are not agents.
  // We confirm again inside handleChat() using the full transcript.
  if (timers.has(chatId)) clearTimeout(timers.get(chatId));
  timers.set(
    chatId,
    setTimeout(() => {
      timers.delete(chatId);
      handleChat(chatId, p.thread_id, ev.id).catch((err) => console.error(`[${chatId}] handler error:`, err.message));
    }, cfg.debounceMs)
  );
});

async function handleChat(chatId, threadId, triggerEventId) {
  if (inFlight.has(chatId)) {
    // Another run is in progress; re-queue once it finishes.
    setTimeout(() => handleChat(chatId, threadId, triggerEventId).catch(console.error), 1500);
    return;
  }
  inFlight.add(chatId);
  try {
    const chat = await getChat(chatId, threadId);
    const last = chat.messages[chat.messages.length - 1];

    // Only respond when the visitor spoke last (prevents answering our own or a human's message).
    if (!last || last.role !== "visitor") return;

    const key = `${last.at}|${last.text}`;
    if (lastHandled.get(chatId) === key) return;
    lastHandled.set(chatId, key);

    // In auto mode, stay out of the way once a human has joined or we've handed off.
    if (cfg.mode === "auto" && (chat.hasHumanAgent || handedOff.has(chatId))) {
      console.log(`[${chatId}] human involved, bot staying quiet`);
      return;
    }
    if (cfg.mode === "auto" && chat.agentReplyCount >= cfg.maxAgentRepliesPerChat) {
      console.log(`[${chatId}] reply cap reached, handing off`);
      await sendMessage(chatId, "Let me get one of the team to jump in here so you get a proper answer.", {});
      handedOff.add(chatId);
      await notifyTeam(chat, { handoff: true, handoff_reason: "Reply cap reached", lead_score: "warm", summary: "Long conversation, needs a human.", captured: {} });
      return;
    }

    const d = await decide(chat);
    console.log(`[${chatId}] score=${d.lead_score} handoff=${d.handoff} mode=${cfg.mode}`);

    // 1) Tag the thread for reporting
    const tag = tagFor(d.lead_score);
    if (tag && chat.threadId) {
      await tagThread(chatId, chat.threadId, tag).catch((e) => console.error(`[${chatId}] tag failed: ${e.message}`));
    }

    // 2) Reply (or draft)
    if (d.reply && d.reply.trim()) {
      if (cfg.mode === "auto") {
        await sendMessage(chatId, d.reply.trim());
      } else {
        await sendMessage(chatId, `DRAFT REPLY (copy/paste or edit):\n${d.reply.trim()}`, { privateNote: true });
      }
    }

    // 3) Internal summary note for the team
    await sendMessage(chatId, internalNote(d), { privateNote: true });

    // 4) Handoff / hot lead alert
    if (d.handoff || d.lead_score === "hot") {
      if (cfg.mode === "auto") handedOff.add(chatId);
      await notifyTeam(chat, d);
    }
  } finally {
    inFlight.delete(chatId);
  }
}

function tagFor(score) {
  if (score === "hot") return cfg.tags.hot;
  if (score === "warm") return cfg.tags.warm;
  if (score === "cold") return cfg.tags.cold;
  if (score === "spam") return cfg.tags.spam;
  return null; // not_a_lead
}

function internalNote(d) {
  const c = d.captured || {};
  const known = Object.entries(c)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
  return [
    `LEAD: ${String(d.lead_score).toUpperCase()}${d.handoff ? "  -  HANDOFF: " + (d.handoff_reason || "human needed") : ""}`,
    d.summary,
    known ? `Captured: ${known}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyTeam(chat, d) {
  const name = chat.customer?.name || "Website visitor";
  const text = `${d.lead_score === "hot" ? "🔥 Hot lead" : "Chat needs a human"} on tinybull.com chat: ${name}\n${d.handoff_reason || ""}\n${d.summary || ""}`.trim();
  if (cfg.mock || !cfg.slackWebhook) {
    console.log(`[notify] ${text}`);
    return;
  }
  try {
    await fetch(cfg.slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error("slack notify failed:", e.message);
  }
}

app.listen(cfg.port, () => {
  console.log(`tinybull-chat-agent listening on :${cfg.port} (mode=${cfg.mode}, mock=${cfg.mock})`);
});
