// WhatsApp simulator (port 8890). Playwright redirects https://wa.me/** and https://api.whatsapp.com/** here (see lib/whatsapp.mjs routeWhatsApp).
//   GET  /chat?to=<digits>&text=<message>&as=<sender digits>   a chat with that number, the message pre-filled, a SEND button; NOTHING is sent until it is pressed (like the real app)
//   POST /api/send {from?, to, text}                            the message lands in that number's inbox
//   GET  /api/inbox/<number>[?after=<id>]                       messages received by that number (matching on the last 10 digits, so +91 and plain forms agree), each with its links
//   GET  /api/all   DELETE /api/all                             everything recorded / reset
//   GET  /inbox/<number>                                        the recipient's "phone": messages with tappable links (the harness opens a link in a new mobile context)
// Run: bun tools/sim2/whatsapp/server.ts   (env WA_PORT=8890)
export interface WaMessage { id: number; at: number; from: string; to: string; text: string; links: string[] }
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const key = (n: string) => digits(n).slice(-10);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const URLRE = /https?:\/\/[^\s<>"')]+/g;

export function startWhatsApp(port = Number(process.env.WA_PORT ?? 8890)) {
  const msgs: WaMessage[] = []; let seq = 0;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  const html = (s: string) => new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
  const css = "body{font:16px system-ui;margin:0;background:#e5ddd5}header{background:#075e54;color:#fff;padding:12px 16px;font-weight:600}main{padding:14px;max-width:520px;margin:auto}.bubble{background:#dcf8c6;border-radius:10px;padding:8px 10px;margin:8px 0;white-space:pre-wrap;word-break:break-word}.in{background:#fff}textarea,input{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #bbb;border-radius:8px}button{background:#25d366;border:0;border-radius:20px;color:#fff;font:600 16px system-ui;padding:10px 22px;margin-top:8px}small{color:#667}a{color:#0b57d0}";
  const send = (from: string, to: string, text: string) => {
    const m: WaMessage = { id: ++seq, at: Date.now(), from: digits(from), to: digits(to), text, links: text.match(URLRE) ?? [] };
    msgs.push(m); return m;
  };
  const chatPage = (to: string, text: string, as: string) => html(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>WhatsApp (simulator)</title><style>${css}</style>
<header>WhatsApp <small style="color:#cfe">simulator, nothing real is sent</small></header><main>
<p id="who">${to ? `Chat with <b id="to-label">+${esc(to)}</b>` : `<label>Send to (number with country code)<input id="to" inputmode="numeric" placeholder="919876543210"></label>`}</p>
<label>Message<textarea id="msg" rows="6">${esc(text)}</textarea></label>
<button id="send">SEND</button> <span id="done" role="status"></span>
<script>
const as=${JSON.stringify(as)};
document.getElementById('send').onclick=async()=>{const to=${JSON.stringify(to)}||document.getElementById('to').value;
 const r=await fetch('/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:as,to,text:document.getElementById('msg').value})});
 const j=await r.json();document.getElementById('done').textContent=r.ok?'Sent (message '+j.id+')':'Failed';document.body.dataset.sent=r.ok?'1':'0';};
</script></main>`);
  const inboxPage = (n: string) => html(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Phone ${esc(n)}</title><style>${css}</style><header>Inbox of +${esc(n)}</header><main id="list"></main>
<script>
async function load(){const r=await fetch('/api/inbox/${esc(n)}');const j=await r.json();document.getElementById('list').innerHTML=j.messages.map(m=>'<div class="bubble in" data-id="'+m.id+'"><small>from +'+(m.from||'?')+'</small><br>'+m.text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]).replace(/https?:\\/\\/[^\\s<>"')]+/g,u=>'<a href="'+u+'">'+u+'</a>')+'</div>').join('')||'<p>No messages yet.</p>';}
load();setInterval(load,2000);
</script>`);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const u = new URL(req.url), p = u.pathname;
      if (p === "/" || p === "/chat" || p === "/send") return chatPage(digits(u.searchParams.get("to") ?? u.searchParams.get("phone")), u.searchParams.get("text") ?? "", digits(u.searchParams.get("as")));
      if (p === "/api/send" && req.method === "POST") { const b = (await req.json().catch(() => ({}))) as any; if (!digits(b.to) || !String(b.text ?? "").trim()) return json({ error: "to and text needed" }, 400); return json({ ok: true, ...send(b.from, b.to, String(b.text)) }); }
      const ib = p.match(/^\/api\/inbox\/(\d+)$/);
      if (ib) { const after = Number(u.searchParams.get("after") ?? 0); return json({ messages: msgs.filter((m) => key(m.to) === key(ib[1]!) && m.id > after) }); }
      if (p === "/api/all") { if (req.method === "DELETE") { msgs.length = 0; return json({ ok: true }); } return json({ messages: msgs }); }
      const pg = p.match(/^\/inbox\/(\d+)$/); if (pg) return inboxPage(pg[1]!);
      if (p === "/health") return json({ ok: true, count: msgs.length });
      return new Response("Not found", { status: 404 });
    },
  });
  return { server, port, url: `http://localhost:${port}`, messages: msgs, send, stop: () => server.stop(true) };
}
if (import.meta.main) { const w = startWhatsApp(); console.log("WA READY " + w.url); }
