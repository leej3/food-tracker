import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export const REQUIRED_TABLES = [
  "nutrient_definitions",
  "user_roles",
  "family_members",
  "member_access",
  "food_entries",
  "food_entry_nutrients",
  "food_ai_sessions",
  "food_ai_messages",
  "food_ai_candidates",
  "food_ai_inference_events",
  "user_directory",
];

const requiredEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}.`);
  }

  return value;
};

const getPublicApiKey = () =>
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  requiredEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

export const getPublicApiConfig = () => ({
  url: requiredEnv("VITE_SUPABASE_URL"),
  apiKey: getPublicApiKey(),
});

export const createDbClient = () => {
  const connectionString = requiredEnv("SUPABASE_DB_URL");
  const isLocal = connectionString.includes("127.0.0.1") || connectionString.includes("localhost");

  return new Client({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
};

export const schemaCheck = async ({ url, apiKey, tables = REQUIRED_TABLES }) => {
  const failures = [];

  for (const table of tables) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers: {
        apikey: apiKey,
      },
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (response.ok) {
      continue;
    }

    failures.push({
      table,
      status: response.status,
      body: parsed,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
};

export const readMigrationFiles = async () => {
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  const entries = await fs.readdir(migrationsDir);
  return entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((entry) => ({
      name: entry,
      fullPath: path.join(migrationsDir, entry),
    }));
};

const resetSql = `
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists user_directory_sync on auth.users;

drop policy if exists food_photos_upload on storage.objects;
drop policy if exists food_photos_select on storage.objects;
drop policy if exists food_photos_update on storage.objects;
drop policy if exists food_photos_delete on storage.objects;

delete from storage.objects where bucket_id = 'food-photos';
delete from storage.buckets where id = 'food-photos';

drop table if exists public.food_ai_inference_events cascade;
drop table if exists public.food_ai_candidates cascade;
drop table if exists public.food_ai_messages cascade;
drop table if exists public.food_ai_sessions cascade;
drop table if exists public.food_entry_nutrients cascade;
drop table if exists public.food_entries cascade;
drop table if exists public.member_access cascade;
drop table if exists public.user_directory cascade;
drop table if exists public.family_members cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.nutrient_definitions cascade;

drop function if exists public.update_food_entry_with_values(uuid, text, timestamptz, public.meal_time, numeric, text, text, jsonb);
drop function if exists public.search_user_directory(text);
drop function if exists public.sync_user_directory();
drop function if exists public.sanitize_member_name(text);
drop function if exists public.get_nutrients_for_entry(uuid);
drop function if exists public.finalize_food_entry(uuid);
drop function if exists public.apply_food_entry_ai_candidate(uuid, uuid);
drop function if exists public.ensure_member_accesses();
drop function if exists public.can_modify_entry(uuid, uuid);
drop function if exists public.can_manage_member(uuid, uuid);
drop function if exists public.can_access_member(uuid, uuid);
drop function if exists public.is_food_admin(uuid);
drop function if exists public.handle_new_user_role();
drop function if exists public.touch_updated_at();
drop function if exists public.touch_updated_at_insert();

drop type if exists public.ai_session_state cascade;
drop type if exists public.nutrient_source cascade;
drop type if exists public.food_entry_state cascade;
drop type if exists public.food_access_level cascade;
drop type if exists public.meal_time cascade;
`;

export const resetManagedFoodTrackerSchema = async (client) => {
  await client.query(resetSql);
};

export const applyMigrationFiles = async (client) => {
  const files = await readMigrationFiles();
  for (const file of files) {
    const sql = await fs.readFile(file.fullPath, "utf8");
    await client.query(sql);
  }
};

export const reloadSchemaCache = async (client) => {
  await client.query("select pg_notify('pgrst', 'reload schema');");
  await new Promise((resolve) => {
    setTimeout(resolve, 1500);
  });
};
