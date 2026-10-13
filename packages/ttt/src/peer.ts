// Phone to phone (and laptop to laptop): a WebRTC data channel carries the moves, so the game itself uses no server.
// The only thing a server does is the "meeting point": two phones that have never met leave each other one short note (an offer and an answer) so they can open the channel.
// That is about 2 posts and a few polls per match, not per move. After the channel opens, the meeting point is never used again.
//
// Role A (the lower seat) makes the offer, role B answers. ICE candidates are gathered before posting (no trickling), so each side posts exactly once.

export interface SignalMsg { type: "offer" | "answer"; sdp: string }
export interface Signal {
  post(match: string, from: "A" | "B", msg: SignalMsg): Promise<void>;
  /** Notes left for `me` after index `after`; `next` is the index to ask from next time. */
  poll(match: string, me: "A" | "B", after: number): Promise<{ msgs: SignalMsg[]; next: number }>;
}

export class HttpSignal implements Signal {
  posts = 0; polls = 0;
  constructor(private base: string) {}
  async post(match: string, from: "A" | "B", msg: SignalMsg): Promise<void> {
    this.posts++; const r = await fetch(`${this.base}/sig/${encodeURIComponent(match)}/${from}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
    if (!r.ok) throw new Error(`meeting point refused (${r.status})`);
  }
  async poll(match: string, me: "A" | "B", after: number): Promise<{ msgs: SignalMsg[]; next: number }> {
    this.polls++; const r = await fetch(`${this.base}/sig/${encodeURIComponent(match)}/${me}?after=${after}`);
    if (!r.ok) throw new Error(`meeting point refused (${r.status})`);
    return (await r.json()) as { msgs: SignalMsg[]; next: number };
  }
}

export interface PeerOptions {
  match: string; role: "A" | "B"; signal: Signal;
  /** Public STUN servers help phones behind home routers find each other. A relay (TURN) is needed behind strict office firewalls; see docs/PROTOTYPE_NOTES.md. */
  iceServers?: RTCIceServer[]; pollMs?: number; timeoutMs?: number;
}
export interface Peer { send(msg: unknown): void; onMessage(fn: (m: any) => void): void; onClose(fn: () => void): void; close(): void; openMs: number; candidateTypes: string[]; pc: RTCPeerConnection }

const waitIce = (pc: RTCPeerConnection, ms: number): Promise<void> => new Promise((res) => {
  if (pc.iceGatheringState === "complete") return res();
  const done = () => { pc.removeEventListener("icegatheringstatechange", chk); res(); };
  const chk = () => { if (pc.iceGatheringState === "complete") done(); };
  pc.addEventListener("icegatheringstatechange", chk); setTimeout(done, ms);
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function connectPeer(o: PeerOptions): Promise<Peer> {
  const t0 = Date.now(), pollMs = o.pollMs ?? 700, deadline = t0 + (o.timeoutMs ?? 40000);
  const pc = new RTCPeerConnection({ iceServers: o.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }] });
  const handlers: ((m: any) => void)[] = [], closers: (() => void)[] = []; let ch: RTCDataChannel | null = null;
  const bind = (c: RTCDataChannel) => { ch = c; c.onmessage = (e) => { let m: unknown; try { m = JSON.parse(String(e.data)); } catch { return; } for (const h of handlers) h(m); }; c.onclose = () => closers.forEach((f) => f()); };
  const opened = new Promise<void>((res, rej) => {
    const fail = () => rej(new Error("could not connect"));
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") fail(); if (pc.connectionState === "disconnected" || pc.connectionState === "closed") closers.forEach((f) => f()); };
    if (o.role === "A") { const c = pc.createDataChannel("ttt", { ordered: true }); bind(c); c.onopen = () => res(); }
    else pc.ondatachannel = (e) => { bind(e.channel); if (e.channel.readyState === "open") res(); else e.channel.onopen = () => res(); };
  });
  const waitFor = async (type: SignalMsg["type"]): Promise<SignalMsg> => {
    let after = 0;
    while (Date.now() < deadline) { const r = await o.signal.poll(o.match, o.role, after); after = r.next; const m = r.msgs.find((x) => x.type === type); if (m) return m; await sleep(pollMs); }
    throw new Error("the other player did not arrive in time");
  };
  if (o.role === "A") {
    await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc, 3000);
    await o.signal.post(o.match, "A", { type: "offer", sdp: pc.localDescription!.sdp });
    const ans = await waitFor("answer"); await pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
  } else {
    const off = await waitFor("offer"); await pc.setRemoteDescription({ type: "offer", sdp: off.sdp });
    await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc, 3000);
    await o.signal.post(o.match, "B", { type: "answer", sdp: pc.localDescription!.sdp });
  }
  await Promise.race([opened, sleep(Math.max(1000, deadline - Date.now())).then(() => { throw new Error("the channel did not open"); })]);
  const candidateTypes = [...new Set((pc.localDescription?.sdp ?? "").split("\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[7] ?? "?"))];
  return {
    send: (m) => { if (ch?.readyState === "open") ch.send(JSON.stringify(m)); },
    onMessage: (f) => { handlers.push(f); }, onClose: (f) => { closers.push(f); },
    close: () => { try { ch?.close(); pc.close(); } catch { /* already closed */ } }, openMs: Date.now() - t0, candidateTypes, pc,
  };
}
