import { execSync } from "node:child_process";

const ADMIN_EMAILS = process.env.FOOD_ADMIN_EMAILS
  ? process.env.FOOD_ADMIN_EMAILS.split(",").map((value) => value.trim()).filter(Boolean)
  : [];

const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "localdevpassword123";

function parseStatusEnv(raw) {
  const parsed = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    if (!/^[A-Z0-9_]+$/.test(key)) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

async function createOrVerifyUser({ apiUrl, serviceRoleKey, email }) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    }),
  });

  if (response.ok) {
    return "created";
  }

  const body = await response.text();
  if (response.status === 422 && /already/i.test(body)) {
    return "exists";
  }

  throw new Error(`failed to create ${email}: ${response.status} ${body}`);
}

async function main() {
  if (ADMIN_EMAILS.length === 0) {
    console.log("No FOOD_ADMIN_EMAILS set. Nothing to seed.");
    return;
  }

  const statusEnv = execSync("npx --yes supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vars = parseStatusEnv(statusEnv);

  const apiUrl = vars.API_URL;
  const serviceRoleKey = vars.SERVICE_ROLE_KEY;

  if (!apiUrl || !serviceRoleKey) {
    throw new Error("Supabase not running. Start it first: npm run supabase:start");
  }

  if (DEFAULT_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  for (const email of ADMIN_EMAILS) {
    const status = await createOrVerifyUser({
      apiUrl,
      serviceRoleKey,
      email,
    });
    console.log(`${email}: ${status}`);
  }

  console.log("seed complete");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
