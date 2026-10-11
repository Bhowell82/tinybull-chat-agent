# TinyBull Chat Agent

An AI sales agent for the TinyBull website chat. It watches LiveChat, replies to visitors in a natural voice, qualifies them over the conversation, tags each chat hot / warm / cold / spam, and flags hot leads for a human.

## How it works

1. LiveChat sends a webhook to `POST /webhook/livechat` whenever a new message arrives.
2. The service waits a few seconds (so rapid-fire messages are batched), pulls the full transcript, and asks Claude for a structured decision: reply text, lead score, handoff flag, summary, and captured details.
3. It tags the thread, then either:
   - **suggest mode (default):** posts the draft as a private note only your team sees, or
   - **auto mode:** replies to the visitor directly.
4. A private summary note is added to every chat. Hot leads and handoffs also ping Slack (optional).

Guardrails built in: it only answers when the visitor spoke last, ignores private notes, goes quiet once a human teammate replies, stops after 12 bot replies in one chat and hands off, and will not deny being an AI if a visitor sincerely asks.

## Setup

### 1. Create the LiveChat pieces
- Create a dedicated agent for the bot (for example "Sam") so its messages show a distinct name. Note its agent ID (the email).
- Create a Personal Access Token for that agent with permission to read chats, send messages, and tag threads. Note your LiveChat account ID.
- Create these tags in LiveChat Settings > Tags: `lead-hot`, `lead-warm`, `lead-cold`, `lead-spam`.

### 2. Deploy on Railway
- Push this folder to a GitHub repo and create a Railway service from it (or `railway up` from this folder).
- Set the variables from `.env.example`. At minimum: `ANTHROPIC_API_KEY`, `LIVECHAT_ACCOUNT_ID`, `LIVECHAT_PAT`, `LIVECHAT_WEBHOOK_SECRET` (any long random string), `LIVECHAT_BOT_AGENT_ID`.
- Generate a public domain for the service. Check `https://YOUR-DOMAIN/health`.

### 3. Register the webhook
Use LiveChat's Configuration API (`register_webhook`) with:
- `action`: `incoming_event`
- `url`: `https://YOUR-DOMAIN/webhook/livechat`
- `secret_key`: the same value as `LIVECHAT_WEBHOOK_SECRET`
- `type`: `license` (so it sees all chats)

Confirm the exact request shape and required scopes in LiveChat's current docs before registering.

### 4. Roll out in stages
1. Leave `AGENT_MODE=suggest` for a week. Read the drafts, edit the system prompt in `src/prompt.js` until they sound like you.
2. Switch to `AGENT_MODE=auto` when you trust it. Consider limiting it to after-hours at first.

## Local testing
```
npm install
MOCK=1 PORT=3111 DEBOUNCE_MS=300 npm start
URL=http://localhost:3111/webhook/livechat npm run test:webhook
```
`MOCK=1` skips real LiveChat and Claude calls and prints what it would have done.

## Things to fill in
- `BOOKING_URL`: your discovery-call link, so the agent can send it.
- Pricing: the agent is told never to quote prices. If you want it to mention starting ranges, add them to `src/prompt.js`.
- The webhook and API request shapes follow LiveChat's v3.5 Agent Chat API. They were written from the documented format and tested here only against mocks, so verify against a real chat in suggest mode first.
