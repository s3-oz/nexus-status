#!/usr/bin/env node
/**
 * kv-events-snapshot.js — Mini-only cron writer
 *
 * Pulls /api/activity/stats from the local nexus-status Fastify server
 * and PUTs the full payload to Cloudflare KV at `omniat:events-ticker`.
 *
 * The Omniat website (/src/app/api/activity/route.ts) reads this KV key
 * instead of tunnelling through to Mini for every request — the tunnel
 * is still used for cheap top-line stats, but the expensive event feed
 * is served from KV cache.
 *
 * Env (expected in ~/.claude/.env.local on Mini):
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN    (scope: Workers KV Storage:Edit)
 *   KV_NAMESPACE_ID         (omniat-activity)
 *   NEXUS_STATUS_API_KEY    (inherited from ~/dev/tools/nexus-status/.env)
 *
 * Run: node scripts/kv-events-snapshot.js
 * Schedule: launchd plist at ~/Library/LaunchAgents/com.nexus.kv-events.plist
 *           (every 5 minutes, triggers this script via /usr/local/bin/node)
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Load env from ~/.claude/.env.local (CF creds) and nexus-status/.env (DB + API key)
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.env.HOME, '.claude', '.env.local'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  KV_NAMESPACE_ID,
  NEXUS_STATUS_API_KEY,
} = process.env;

const STATS_URL = process.env.NEXUS_STATUS_URL || 'http://localhost:3457/api/activity/stats?limit=250';
const KV_KEY = process.env.OMNIAT_KV_KEY || 'omniat:events-ticker';

function die(msg, code = 1) {
  console.error(`[kv-events-snapshot] FATAL: ${msg}`);
  process.exit(code);
}

if (!CLOUDFLARE_ACCOUNT_ID) die('CLOUDFLARE_ACCOUNT_ID not set');
if (!CLOUDFLARE_API_TOKEN) die('CLOUDFLARE_API_TOKEN not set');
if (!KV_NAMESPACE_ID) die('KV_NAMESPACE_ID not set');
if (!NEXUS_STATUS_API_KEY) die('NEXUS_STATUS_API_KEY not set');

async function fetchStats() {
  const res = await fetch(STATS_URL, {
    headers: { 'X-API-Key': NEXUS_STATUS_API_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`stats endpoint returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

async function putKV(payload) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(KV_KEY)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`KV PUT returned ${res.status}: ${body}`);
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed.success === false) {
      throw new Error(`KV PUT success=false: ${JSON.stringify(parsed.errors)}`);
    }
  } catch (e) {
    // body may not be JSON, that's fine if status was 2xx
  }
}

(async () => {
  const startedAt = Date.now();
  try {
    const stats = await fetchStats();
    const snapshot = {
      ...stats,
      snapshotAt: new Date().toISOString(),
      source: 'nexus-status-mini',
      eventCount: (stats.recentEvents || []).length,
    };
    await putKV(snapshot);
    const ms = Date.now() - startedAt;
    console.log(`[kv-events-snapshot] OK events=${snapshot.eventCount} pulse=${(snapshot.pulse || []).length} ${ms}ms key=${KV_KEY}`);
  } catch (err) {
    console.error(`[kv-events-snapshot] FAILED after ${Date.now() - startedAt}ms: ${err.message}`);
    process.exit(2);
  }
})();
