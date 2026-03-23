import {
  applyMigrationFiles,
  createDbClient,
  getPublicApiConfig,
  reloadSchemaCache,
  resetManagedFoodTrackerSchema,
  schemaCheck,
} from "./supabase-schema-utils.mjs";

const mode = process.env.FOOD_TRACKER_DB_BOOTSTRAP ?? "apply_if_missing";
const schemaCheckAttempts = Number(process.env.FOOD_TRACKER_SCHEMA_CHECK_ATTEMPTS ?? 4);
const schemaCheckDelayMs = 5_000;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const logFailures = (result) => {
  for (const failure of result.failures) {
    console.error(`${failure.table}: ${failure.status} ${JSON.stringify(failure.body)}`);
  }
};

const schemaCheckWithRetries = async (apiConfig) => {
  let lastResult = null;

  for (let attempt = 1; attempt <= schemaCheckAttempts; attempt += 1) {
    lastResult = await schemaCheck(apiConfig);
    if (lastResult.ok) {
      return lastResult;
    }

    if (attempt < schemaCheckAttempts) {
      console.warn(
        `Supabase schema check failed (attempt ${attempt}/${schemaCheckAttempts}); retrying in ${schemaCheckDelayMs}ms.`,
      );
      await sleep(schemaCheckDelayMs);
    }
  }

  return lastResult;
};

const main = async () => {
  const apiConfig = getPublicApiConfig();
  const initialCheck = await schemaCheckWithRetries(apiConfig);

  if (initialCheck.ok && mode !== "reset_and_reseed") {
    console.log("Supabase schema already ready. No bootstrap required.");
    return;
  }

  if (!initialCheck.ok && mode === "check") {
    console.error("Supabase schema is not ready and bootstrap mode is check.");
    logFailures(initialCheck);
    process.exitCode = 1;
    return;
  }

  if (!initialCheck.ok && !process.env.SUPABASE_DB_URL) {
    console.error("Supabase schema is not ready and SUPABASE_DB_URL is not configured for bootstrap.");
    logFailures(initialCheck);
    process.exitCode = 1;
    return;
  }

  const client = createDbClient();

  try {
    await client.connect();
    console.log(`Bootstrapping Supabase schema with mode=${mode}.`);
    await resetManagedFoodTrackerSchema(client);
    await applyMigrationFiles(client);
    await reloadSchemaCache(client);
  } finally {
    await client.end();
  }

  const finalCheck = await schemaCheckWithRetries(apiConfig);
  if (!finalCheck.ok) {
    console.error("Supabase schema bootstrap failed verification.");
    logFailures(finalCheck);
    process.exitCode = 1;
    return;
  }

  console.log("Supabase schema bootstrap completed successfully.");
};

await main();
