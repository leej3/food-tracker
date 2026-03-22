import {
  applyMigrationFiles,
  createDbClient,
  getPublicApiConfig,
  reloadSchemaCache,
  resetManagedFoodTrackerSchema,
  schemaCheck,
} from "./supabase-schema-utils.mjs";

const mode = process.env.FOOD_TRACKER_DB_BOOTSTRAP ?? "apply_if_missing";

const main = async () => {
  const apiConfig = getPublicApiConfig();
  const initialCheck = await schemaCheck(apiConfig);

  if (initialCheck.ok && mode !== "reset_and_reseed") {
    console.log("Supabase schema already ready. No bootstrap required.");
    return;
  }

  if (!initialCheck.ok && mode === "check") {
    console.error("Supabase schema is not ready and bootstrap mode is check.");
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

  const finalCheck = await schemaCheck(apiConfig);
  if (!finalCheck.ok) {
    console.error("Supabase schema bootstrap failed verification.");
    for (const failure of finalCheck.failures) {
      console.error(`${failure.table}: ${failure.status} ${JSON.stringify(failure.body)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Supabase schema bootstrap completed successfully.");
};

await main();
