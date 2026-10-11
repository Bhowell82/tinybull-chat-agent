// Sends a fake LiveChat "incoming_event" webhook to a locally running server (MOCK=1).
const url = process.env.URL || "http://localhost:3000/webhook/livechat";

const payload = {
  webhook_id: "test",
  secret_key: "test",
  action: "incoming_event",
  payload: {
    chat_id: "TESTCHAT1",
    thread_id: "TESTTHREAD1",
    event: {
      id: "evt_1",
      type: "message",
      text: "Hi, we're an HVAC company in Roanoke and our Google Ads are a mess. Do you guys fix that?",
      author_id: "cust1",
      visibility: "all",
      created_at: new Date().toISOString(),
    },
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log("status", res.status, await res.text());
