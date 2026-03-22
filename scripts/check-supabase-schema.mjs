import { getPublicApiConfig, schemaCheck } from "./supabase-schema-utils.mjs";

const main = async () => {
  const result = await schemaCheck(getPublicApiConfig());
  if (result.ok) {
    console.log("Supabase schema check passed.");
    return;
  }

  console.error("Supabase schema check failed.");
  for (const failure of result.failures) {
    console.error(`${failure.table}: ${failure.status} ${JSON.stringify(failure.body)}`);
  }

  process.exitCode = 1;
};

await main();
