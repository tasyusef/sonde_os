#!/usr/bin/env node
/**
 * /opt/sonde_intel/infra/hetzner-deploy/webhook.mjs
 *
 * Minimal Forgejo webhook listener. Verifies the HMAC signature on
 * incoming pushes and shells out to the appropriate deploy script per
 * ref. One branch is wired:
 *
 *   refs/heads/master                  → deploy.sh
 *       Updates /opt/sonde_intel + restarts ingester / backfill (the
 *       Next.js production app).
 *
 * Pushes to any other ref are accepted (200) but ignored.
 *
 * Listens on $HOST:$PORT (default 127.0.0.1:9001). Caddy reverse-proxies
 * the git host's /webhooks/deploy path → the bound address.
 *
 * Caddy runs in a Docker container on a private bridge network; the
 * listener binds to the bridge's gateway IP — reachable from the
 * bridge, not routable from the public internet.
 *
 * Env (loaded by the systemd unit from /etc/sonde-deploy.env):
 *   DEPLOY_SECRET           shared HMAC secret with Forgejo. REQUIRED.
 *   HOST                    bind interface. Default 127.0.0.1.
 *   PORT                    listener port. Default 9001.
 *   DEPLOY_SCRIPT           master deploy script. Default ./deploy.sh.
 *
 * The HMAC is verified using a constant-time comparison. Forgejo signs
 * with `X-Forgejo-Signature` (sha256 hex); we also accept the gitea-style
 * `X-Gitea-Signature` and the GitHub-style `X-Hub-Signature-256` headers
 * for compatibility.
 *
 * Deploy scripts run detached — the HTTP response goes back to Forgejo
 * as soon as the spawn succeeds. Forgejo doesn't care about deploy
 * duration; long-running pnpm installs would otherwise time out the
 * webhook and trigger retries. Logs from the spawned process are
 * inherited (go to the same journald stream as this listener).
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 9001);
const SECRET = process.env.DEPLOY_SECRET;
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_MASTER = resolve(
  process.env.DEPLOY_SCRIPT ?? resolve(HERE, "deploy.sh"),
);
// Branch → script routing. Add new entries here to handle additional
// auto-deployed branches (e.g. release/v2 once that workflow lands).
const SCRIPTS = {
  "refs/heads/master": SCRIPT_MASTER,
};

if (!SECRET) {
  console.error("[webhook] DEPLOY_SECRET env var required");
  process.exit(1);
}

function verify(body, signature) {
  if (!signature || typeof signature !== "string") return false;
  const expected = createHmac("sha256", SECRET).update(body).digest("hex");
  const sig = signature.replace(/^sha256=/, "");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

createServer((req, res) => {
  const url = req.url ?? "/";

  // Suffix-match to be tolerant of Caddy's path forwarding shape.
  // Whether Caddy strips "/webhooks/deploy" or forwards the full
  // path, we still resolve to "/health" (GET) or "/hook" (POST).
  const isHealth = req.method === "GET" && url.endsWith("/health");
  const isHook = req.method === "POST" && url.endsWith("/hook");

  if (isHealth) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`ok ${process.pid}\n`);
    return;
  }

  if (!isHook) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found\n");
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("error", (err) => {
    console.warn("[webhook] request error:", err.message);
    res.writeHead(400);
    res.end();
  });
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const sig =
      req.headers["x-forgejo-signature"] ??
      req.headers["x-gitea-signature"] ??
      req.headers["x-hub-signature-256"];

    if (!verify(body, sig)) {
      console.warn("[webhook] HMAC verify failed (header present:", !!sig, ")");
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized\n");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      payload = {};
    }

    const ref = payload?.ref ?? "(unknown)";
    const script = SCRIPTS[ref];
    if (!script) {
      const knownRefs = Object.keys(SCRIPTS).join(", ");
      console.log(`[webhook] ignoring push to ${ref} (handled refs: ${knownRefs})`);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`Ignored: ${ref} not in handled refs\n`);
      return;
    }

    const commit = payload?.after?.slice(0, 7) ?? "(unknown)";
    console.log(`[webhook] firing ${script} for ${ref} @ ${commit}`);

    // Detach the deploy so Forgejo gets a fast 202. The child stdio
    // is "inherit" so its output goes to this process's stdout/stderr,
    // which systemd routes to journald — `journalctl -u sonde-deploy`
    // surfaces the deploy logs.
    const child = spawn(script, [], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
      detached: false, // we still want to know the exit code for logs
    });
    child.on("exit", (code) => {
      console.log(`[webhook] deploy exited code ${code} (commit ${commit})`);
    });
    child.on("error", (err) => {
      console.error("[webhook] deploy spawn failed:", err.message);
    });

    res.writeHead(202, { "Content-Type": "text/plain" });
    res.end(`Accepted: ${commit}\n`);
  });
}).listen(PORT, HOST, () => {
  const refs = Object.entries(SCRIPTS)
    .map(([ref, s]) => `  ${ref} → ${s}`)
    .join("\n");
  console.log(`[webhook] listening on ${HOST}:${PORT}\n[webhook] routes:\n${refs}`);
});

// SIGTERM = systemd graceful shutdown
process.on("SIGTERM", () => {
  console.log("[webhook] SIGTERM, shutting down");
  process.exit(0);
});
