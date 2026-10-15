#!/usr/bin/env node
/**
 * Creates a "Repo Control" voice channel in the first guild the bot is in.
 * Reads DISCORD_BOT_TOKEN from env or tools/repo-control/.env — never logs the token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error(JSON.stringify({ error: 'DISCORD_BOT_TOKEN missing' }));
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Discord ${method} ${p} → ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

const guilds = await api('GET', '/users/@me/guilds');
if (!Array.isArray(guilds) || guilds.length === 0) {
  console.log(JSON.stringify({
    ok: false,
    error: 'bot_not_in_any_guild',
    hint: 'Open the invite URL, add Haip Dashboard to your server, then re-run.',
  }));
  process.exit(2);
}

const guildId = process.env.DISCORD_GUILD_ID || guilds[0].id;
const guildName = guilds.find((g) => g.id === guildId)?.name || guilds[0].name;
const channels = await api('GET', `/guilds/${guildId}/channels`);
const existing = channels.find(
  (c) => c.type === 2 && String(c.name).toLowerCase() === 'repo-control',
);
if (existing) {
  console.log(JSON.stringify({
    ok: true,
    action: 'exists',
    guildId,
    guildName,
    channelId: existing.id,
    channelName: existing.name,
  }));
  process.exit(0);
}

const created = await api('POST', `/guilds/${guildId}/channels`, {
  name: 'repo-control',
  type: 2, // guild voice
  topic: 'Telivity Repository Control — Start Activity here (view-only)',
});
console.log(JSON.stringify({
  ok: true,
  action: 'created',
  guildId,
  guildName,
  channelId: created.id,
  channelName: created.name,
}));
