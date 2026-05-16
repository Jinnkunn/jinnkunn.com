import { main } from "./classic-style-contract.mjs";

main({ homeOnly: true }).catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
