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
  model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  lc: {
    accountId: env.LIVECHAT_ACCOUNT_ID || "",
    pat: env.LIVECHAT_PAT || "",
    webhookSecret: env.LIVECHAT_WEBHOOK_SECRET || "",
    // The agent ID (usually the email) of the account the PAT belongs to, so the bot can tell its own messages from a human's
    botAgentId: env.LIVECHAT_BOT_AGENT_ID || "",
  },
  tags: {
    hot: env.TAG_HOT || "lead-hot",
    warm: env.TAG_WARM || "lead-warm",
    cold: env.TAG_COLD || "lead-cold",
    spam: env.TAG_SPAM || "lead-spam",
  },
  slackWebhook: env.SLACK_WEBHOOK_URL || "",
  // Safety valves
  maxAgentRepliesPerChat: 12,
};

export function assertConfig() {
  if (cfg.mock) return;
  const missing = [];
  if (!cfg.anthropicKey) missing.push("ANTHROPIC_API_KEY");
  if (!cfg.lc.accountId) missing.push("LIVECHAT_ACCOUNT_ID");
  if (!cfg.lc.pat) missing.push("LIVECHAT_PAT");
  if (!cfg.lc.webhookSecret) missing.push("LIVECHAT_WEBHOOK_SECRET");
  if (!cfg.lc.botAgentId) missing.push("LIVECHAT_BOT_AGENT_ID");
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
