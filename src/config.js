const env = process.env;

export const cfg = {
  port: Number(env.PORT || 3000),
  mock: env.MOCK === "1",
  mode: (env.AGENT_MODE || "suggest").toLowerCase() === "auto" ? "auto" : "suggest",
  debounceMs: Number(env.DEBOUNCE_MS || 3500),
  agentName: env.AGENT_NAME || "Sam",
  bookingUrl: env.BOOKING_URL || "",
  teamEmail: env.TEAM_EMAIL || "",
  textLine: env.TEXT_LINE || "",
  model: env.CLAUDE_MODEL || "claude-sonnet-4-6",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  lc: {
    accountId: env.LIVECHAT_ACCOUNT_ID || "",
    pat: env.LIVECHAT_PAT || "",
    webhookSecret: env.LIVECHAT_WEBHOOK_SECRET || "",
    // Client ID of the LiveChat app the PAT belongs to (Developer Console > your app > Authorization).
    // Required to register webhooks; webhooks are owned by a client ID.
    clientId: env.LIVECHAT_CLIENT_ID || "",
    // The agent ID (usually the email) of the account the PAT belongs to, so the bot can tell its own messages from a human's
    botAgentId: env.LIVECHAT_BOT_AGENT_ID || "",
  },
  // Public base URL of this service, used to build the webhook URL. Railway sets RAILWAY_PUBLIC_DOMAIN automatically.
  publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/+$/, ""),
  tags: {
    hot: env.TAG_HOT || "lead-hot",
    warm: env.TAG_WARM || "lead-warm",
    cold: env.TAG_COLD || "lead-cold",
    spam: env.TAG_SPAM || "lead-spam",
  },
  fredContext: env.FRED_CONTEXT || "",
  resiContext: env.RESI_CONTEXT || "",
  slackWebhook: env.SLACK_WEBHOOK_URL || "",
  // Webhook: when a secret and client ID are set, the service registers the LiveChat webhook on boot
  // (idempotent) and polling drops back to a slow safety net.
  webhook: {
    configured: Boolean(env.LIVECHAT_WEBHOOK_SECRET && env.LIVECHAT_CLIENT_ID),
    autoRegister: env.WEBHOOK_AUTO_REGISTER !== "0",
  },
  // Polling needs only the personal access token (no LiveChat app or webhook).
  // Default: every 5s when polling is the only source; every 5 min as a safety net once a webhook is configured.
  poll: {
    enabled: env.POLL_ENABLED !== "0",
    intervalMs: Number(env.POLL_INTERVAL_MS || (env.LIVECHAT_WEBHOOK_SECRET && env.LIVECHAT_CLIENT_ID ? 300_000 : 5000)),
  },
  // Safety valves
  maxAgentRepliesPerChat: 12,
};

export function assertConfig() {
  if (cfg.mock) return;
  const missing = [];
  if (!cfg.anthropicKey) missing.push("ANTHROPIC_API_KEY");
  if (!cfg.lc.accountId) missing.push("LIVECHAT_ACCOUNT_ID");
  if (!cfg.lc.pat) missing.push("LIVECHAT_PAT");
  if (!cfg.lc.botAgentId) missing.push("LIVECHAT_BOT_AGENT_ID");
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
