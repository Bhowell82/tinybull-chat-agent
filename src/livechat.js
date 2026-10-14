import { cfg } from "./config.js";

const BASE = "https://api.livechatinc.com/v3.5/agent/action";

function authHeader() {
  const token = Buffer.from(`${cfg.lc.accountId}:${cfg.lc.pat}`).toString("base64");
  return `Basic ${token}`;
}

async function call(action, body) {
  const res = await fetch(`${BASE}/${action}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LiveChat ${action} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Returns a normalized chat:
 * { chatId, threadId, customer: {id,name,email}, messages: [{role, text, at}], agentReplyCount, tags }
 * role is "visitor" | "team" (any non-customer author, including this bot)
 */
export async function getChat(chatId, threadId) {
  if (cfg.mock) return mockChat(chatId);
  const raw = await call("get_chat", { chat_id: chatId, ...(threadId ? { thread_id: threadId } : {}) });
  const customerIds = new Set((raw.users || []).filter((u) => u.type === "customer").map((u) => u.id));
  const customer = (raw.users || []).find((u) => u.type === "customer") || {};
  const thread = raw.thread || {};
  const events = thread.events || [];

  const messages = [];
  let agentReplyCount = 0;
  for (const ev of events) {
    if (ev.type !== "message" || !ev.text) continue;
    if (ev.visibility && ev.visibility !== "all") continue; // skip private notes
    const isVisitor = customerIds.has(ev.author_id);
    if (!isVisitor) agentReplyCount += 1;
    messages.push({ role: isVisitor ? "visitor" : "team", text: ev.text, at: ev.created_at });
  }

  const pages = customer.last_visit?.last_pages || [];
  const siteUrl = pages[0]?.url || "";

  return {
    chatId,
    threadId: thread.id || threadId,
    customer: { id: customer.id, name: customer.name || "", email: customer.email || "" },
    siteUrl,
    messages,
    agentReplyCount,
    tags: thread.tags || [],
    // A human has joined if a non-customer, non-bot author posted a public message AFTER the
    // visitor's first message. Proactive greetings come before it, so they never count.
    hasHumanAgent: (() => {
      const firstVisitor = events.findIndex((ev) => ev.type === "message" && customerIds.has(ev.author_id));
      if (firstVisitor === -1) return false;
      return events.slice(firstVisitor + 1).some(
        (ev) =>
          ev.type === "message" &&
          (!ev.visibility || ev.visibility === "all") &&
          ev.author_id &&
          !customerIds.has(ev.author_id) &&
          ev.author_id !== cfg.lc.botAgentId
      );
    })(),
  };
}

export async function sendMessage(chatId, text, { privateNote = false } = {}) {
  if (cfg.mock) {
    console.log(`[mock] ${privateNote ? "PRIVATE NOTE" : "PUBLIC REPLY"} -> ${chatId}: ${text}`);
    return {};
  }
  return call("send_event", {
    chat_id: chatId,
    event: { type: "message", text, visibility: privateNote ? "agents" : "all" },
  });
}

export async function setRoutingStatus(status) {
  if (cfg.mock) { console.log(`[mock] routing status -> ${status}`); return; }
  return call("set_routing_status", { status });
}

export async function tagThread(chatId, threadId, tag) {
  if (cfg.mock) {
    console.log(`[mock] TAG ${tag} -> ${chatId}/${threadId}`);
    return {};
  }
  return call("tag_thread", { chat_id: chatId, thread_id: threadId, tag });
}

let mockPolled = false;

/**
 * Lists active chats whose latest public message was written by the visitor.
 * Returns [{ chatId, threadId, eventId, at }]. Used by the poller instead of webhooks.
 */
export async function listVisitorMessages(limit = 25) {
  if (cfg.mock) {
    if (mockPolled) return [];
    mockPolled = true;
    return [{ chatId: "MOCKCHAT", threadId: "MOCKTHREAD", eventId: "mock-ev-1", at: new Date().toISOString() }];
  }
  const raw = await call("list_chats", { filters: { include_active: true }, limit });
  const out = [];
  for (const c of raw.chats_summary || []) {
    const last = c.last_event_per_type?.message;
    const ev = last?.event;
    if (!ev || !ev.text) continue;
    if (ev.visibility && ev.visibility !== "all") continue;
    const customerIds = new Set((c.users || []).filter((u) => u.type === "customer").map((u) => u.id));
    if (!customerIds.has(ev.author_id)) continue;
    out.push({ chatId: c.id, threadId: last.thread_id, eventId: ev.id, at: ev.created_at });
  }
  return out;
}

function mockChat(chatId) {
  return {
    chatId,
    threadId: "MOCKTHREAD",
    customer: { id: "cust1", name: "Dana", email: "" },
    messages: [
      { role: "visitor", text: "Hi, we're an HVAC company in Roanoke and our Google Ads are a mess. Do you guys fix that?", at: new Date().toISOString() },
    ],
    agentReplyCount: 0,
    tags: [],
    hasHumanAgent: false,
  };
}
