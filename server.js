const http = require("node:http");

const PORT = process.env.PORT || 3000;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://game-game-t6az.onrender.com";
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const requests = new Map();

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}
function rateLimited(ip) {
  const now = Date.now();
  const recent = (requests.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 3) return true;
  recent.push(now);
  requests.set(ip, recent);
  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/api/game-request") {
    return send(res, 404, { error: "Not found" });
  }
  const origin = req.headers.origin;
  if (origin && origin !== SITE_ORIGIN) return send(res, 403, { error: "送信元を確認できませんでした。" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (rateLimited(ip)) return send(res, 429, { error: "送信回数が多すぎます。10分ほど待ってから再度お試しください。" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) {
      req.destroy();
      return;
    }
  }
  let data;
  try { data = JSON.parse(raw || "{}"); }
  catch { return send(res, 400, { error: "入力内容を読み取れませんでした。" }); }

  // Honeypot: bots fill this hidden field; silently accept without sending.
  if (data.website) return send(res, 200, { ok: true });
  const title = String(data.title || "").trim();
  const url = String(data.url || "").trim();
  const details = String(data.details || "").trim();
  const sender = String(data.sender || "").trim().slice(0, 60);

  if (!title || title.length > 80) return send(res, 400, { error: "ゲーム名を80文字以内で入力してください。" });
  if (!url || url.length > 500) return send(res, 400, { error: "ゲームURLを入力してください。" });
  let parsed;
  try { parsed = new URL(url); } catch { return send(res, 400, { error: "URLの形式を確認してください。" }); }
  if (!["http:", "https:"].includes(parsed.protocol)) return send(res, 400, { error: "http または https のURLを入力してください。" });
  if (details.length > 3000) return send(res, 400, { error: "紹介文は3000文字以内にしてください。" });
  if (!RECIPIENT_EMAIL || !RESEND_API_KEY) return send(res, 503, { error: "現在、依頼メールの送信設定中です。少し時間をおいて再度お試しください。" });

  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(url);
  const safeDetails = escapeHtml(details || "（紹介文なし）").replace(/\n/g, "<br>");
  const safeSender = escapeHtml(sender || "名前の記載なし");
  const html = `
    <div style="font-family:Arial,'Noto Sans JP',sans-serif;max-width:640px;margin:auto;padding:28px;color:#202334;background:#f6f7fb;border-radius:16px">
      <div style="font-size:12px;letter-spacing:2px;color:#6d63c8;font-weight:bold">GAME GAME / GAME REQUEST</div>
      <h1 style="font-size:24px;margin:12px 0">ゲーム追加のお願い</h1>
      <div style="background:#fff;border:1px solid #e1e3ee;border-radius:12px;padding:22px">
        <p><b>ゲーム名</b><br>${safeTitle}</p>
        <p><b>ゲームURL</b><br><a href="${safeUrl}">${safeUrl}</a></p>
        <p><b>紹介文・メッセージ</b><br>${safeDetails}</p>
        <p><b>送信者名</b><br>${safeSender}</p>
      </div>
      <p style="font-size:12px;color:#777d91;margin-top:18px">このメールはGAME GAMEのゲーム追加フォームから送信されました。</p>
    </div>`;
  const textBody = [
    "GAME GAME / ゲーム追加のお願い",
    "",
    "ゲーム名: " + title,
    "ゲームURL: " + url,
    "紹介文・メッセージ: " + (details || "（紹介文なし）"),
    "送信者名: " + (sender || "名前の記載なし")
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "GAME GAME <onboarding@resend.dev>",
        to: [RECIPIENT_EMAIL],
        subject: "【GAME GAME】ゲーム追加依頼：" + title,
        html,
        text: textBody
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Resend error:", response.status, errorText);
      return send(res, 502, { error: "メールを送信できませんでした。時間をおいて再度お試しください。" });
    }
    return send(res, 200, { ok: true });
  } catch (error) {
    console.error("Email delivery failed:", error);
    return send(res, 502, { error: "メール送信中にエラーが発生しました。" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("GAME GAME request API listening on " + PORT));
