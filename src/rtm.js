// Real-time transport for the LiveChat Agent Chat API.
// One persistent WebSocket, logged in with the same Personal Access Token the Web API uses.
// LiveChat pushes incoming_chat / incoming_event the instant a visitor writes, so no polling is needed
// and the bot agent shows as "connected" (which is also what lets set_routing_status succeed).

import WebSocket from "ws";
import { cfg } from "./config.js";

const PING_MS = 10_000;        // LiveChat closes idle sockets after ~30s; SDK pings every 10s
const LOGIN_TIMEOUT_MS = 20_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export function createRtm({ onVisitorMessage, log = console }) {
  let ws = null;
  let pingTimer = null;
  let backoff = BACKOFF_MIN_MS;
  let stopped = false;
  let reqSeq = 0;
  const pending = new Map(); // request_id -> {resolve, reject, timer}

  const state = {
    status: "starting", // starting | connecting | logged_in | reconnecting | stopped | disabled
    connectedAt: null,
    lastPushAt: null,
    lastError: null,
    reconnects: 0,
  };

  function url() {
    const qs = new URLSearchParams();
    if (cfg.lc.organizationId) qs.set("organization_id", cfg.lc.organizationId);
    if (cfg.lc.region) qs.set("region", cfg.lc.region);
    const q = qs.toString();
    return `wss://api.livechatinc.com/v3.5/agent/rtm/ws${q ? "?" + q : ""}`;
  }

  function token() {
    return "Basic " + Buffer.from(`${cfg.lc.accountId}:${cfg.lc.pat}`).toString("base64");
  }

  function send(action, payload, { timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("socket not open"));
      const request_id = `r${++reqSeq}`;
      const timer = setTimeout(() => {
        pending.delete(request_id);
        reject(new Error(`${action} timed out`));
      }, timeoutMs);
      pending.set(request_id, { resolve, reject, timer });
      ws.send(JSON.stringify({ request_id, action, ...(payload !== undefined ? { payload } : {}) }));
    });
  }

  function handleResponse(msg) {
    const p = pending.get(msg.request_id);
    if (!p) return;
    pending.delete(msg.request_id);
    clearTimeout(p.timer);
    if (msg.success) p.resolve(msg.payload || {});
    else p.reject(new Error(`${msg.action} failed: ${JSON.stringify(msg.payload?.error || msg.payload || {})}`));
  }

  function visitorEventFromPush(action, payload) {
    // incoming_event: a single new event in an existing chat
    if (action === "incoming_event") {
      const ev = payload?.event;
      if (!ev) return null;
      return { chatId: payload.chat_id, threadId: payload.thread_id, event: ev };
    }
    // incoming_chat: a brand-new chat; the opening visitor message rides inside chat.thread.events
    if (action === "incoming_chat") {
      const chat = payload?.chat;
      const thread = chat?.thread;
      const events = thread?.events || [];
      const customerIds = new Set((chat?.users || []).filter((u) => u.type === "customer").map((u) => u.id));
      const last = [...events].reverse().find((e) => e.type === "message" && e.text && customerIds.has(e.author_id));
      if (!last) return null;
      return { chatId: chat.id, threadId: thread.id, event: last };
    }
    return null;
  }

  function handlePush(msg) {
    state.lastPushAt = new Date().toISOString();
    const hit = visitorEventFromPush(msg.action, msg.payload);
    if (!hit) return;
    const ev = hit.event;
    if (ev.type !== "message" || !ev.text) return;
    if (ev.visibility && ev.visibility !== "all") return;            // private notes
    if (ev.author_id && ev.author_id === cfg.lc.botAgentId) return;  // our own replies
    onVisitorMessage({ chatId: hit.chatId, threadId: hit.threadId, eventId: ev.id, authorId: ev.author_id, source: "rtm" });
  }

  async function afterLogin() {
    try {
      await send("set_routing_status", { status: "accepting_chats" });
      log.log("rtm: agent status set to accepting_chats");
    } catch (e) {
      log.error(`rtm: could not set routing status: ${e.message}`);
    }
  }

  function connect() {
    if (stopped) return;
    state.status = state.reconnects ? "reconnecting" : "connecting";
    ws = new WebSocket(url());

    ws.on("open", async () => {
      try {
        await send("login", {
          token: token(),
          application: { name: "tinybull-chat-agent", version: "0.2.0" },
          customer_monitoring_level: "my",
        });
        backoff = BACKOFF_MIN_MS;
        state.status = "logged_in";
        state.connectedAt = new Date().toISOString();
        state.lastError = null;
        log.log(`rtm: logged in${state.reconnects ? ` (reconnect #${state.reconnects})` : ""}`);
        pingTimer = setInterval(() => send("ping", undefined, { timeoutMs: PING_MS }).catch(() => {}), PING_MS);
        afterLogin();
      } catch (e) {
        state.lastError = e.message;
        log.error(`rtm: login failed: ${e.message}`);
        ws.close();
      }
    });

    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === "response") return handleResponse(msg);
      if (msg.type === "push") return handlePush(msg);
    });

    ws.on("error", (err) => {
      state.lastError = err.message;
      log.error(`rtm: socket error: ${err.message}`);
    });

    ws.on("close", (code, reason) => {
      clearInterval(pingTimer);
      pingTimer = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("socket closed")); }
      pending.clear();
      if (stopped) { state.status = "stopped"; return; }
      state.reconnects += 1;
      state.status = "reconnecting";
      log.error(`rtm: socket closed (${code}${reason ? " " + reason : ""}); reconnecting in ${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    });
  }

  return {
    start() { connect(); },
    stop() { stopped = true; try { ws?.close(); } catch {} },
    get state() { return { ...state }; },
  };
}
