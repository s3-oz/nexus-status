# Retired (2026-04-15)
This directory contains code that's been removed from the active pipeline.

## kv-events-snapshot.js
Written to populate a Cloudflare KV snapshot every 5 min via launchd on Mini,
so the Omniat website could avoid tunneling through to Mini on every request.
Never worked right (launchd cron silently failed while manual runs succeeded).
Retired 2026-04-15 when the website was simplified to fetch directly via the
tunnel with 5-min ISR — same freshness, no cron to maintain.
