import test from "node:test";
import assert from "node:assert/strict";

import { createCmsRuntimeConfig } from "../src/backend/cmsPublisher.js";

test("createCmsRuntimeConfig prefers explicit internal host when configured", () => {
  const config = createCmsRuntimeConfig({
    COMP_SERVICE_INTERNAL_HOST: "http://api-internal.uat-frankfurt.pred.app",
    DB_HOST: "reader.mainnet-frankfurt.database.pred.app",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "http://api-internal.uat-frankfurt.pred.app");
});

test("createCmsRuntimeConfig infers CMS internal host from pred DB host", () => {
  const config = createCmsRuntimeConfig({
    DB_HOST: "reader.mainnet-frankfurt.database.pred.app",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "http://api-internal.mainnet-frankfurt.pred.app");
  assert.equal(config.endpoints.fixture, "http://api-internal.mainnet-frankfurt.pred.app/api/v1/cms/internal/fixtures/");
});

test("createCmsRuntimeConfig infers CMS internal host from public pred host when DB host is absent", () => {
  const config = createCmsRuntimeConfig({
    COMP_SERVICE_HOST: "https://dev-frankfurt.pred.app",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "http://api-internal.dev-frankfurt.pred.app");
});
