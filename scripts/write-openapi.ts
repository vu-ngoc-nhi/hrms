// Writes the registry-generated spec to contracts/core-hr/openapi.json for review. A test fails if it drifts.
import { writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/contracts/core-hr/openapi";

writeFileSync("contracts/core-hr/openapi.json", `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log("contracts/core-hr/openapi.json written");
