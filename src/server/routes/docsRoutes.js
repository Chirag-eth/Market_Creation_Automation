export function handleDocsRoutes({ pathname, res, openApiSpec, openApiYaml, sendJson, sendText }) {
  if (pathname === "/api/openapi.json") {
    if (!openApiSpec) {
      sendJson(res, 404, { error: "OpenAPI JSON spec not found." });
      return true;
    }
    sendJson(res, 200, openApiSpec);
    return true;
  }

  if (pathname === "/api/openapi.yaml") {
    if (!openApiYaml) {
      sendText(res, 404, "OpenAPI YAML spec not found.");
      return true;
    }
    sendText(res, 200, openApiYaml, { "Content-Type": "application/yaml; charset=utf-8" });
    return true;
  }

  if (pathname === "/api/docs") {
    const docsHtml = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "  <title>Market Making API Docs</title>",
      "  <style>body{margin:0;padding:0}</style>",
      '  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>',
      "</head>",
      "<body>",
      '  <redoc spec-url="/api/openapi.json"></redoc>',
      "</body>",
      "</html>",
    ].join("\n");
    sendText(res, 200, docsHtml, { "Content-Type": "text/html; charset=utf-8" });
    return true;
  }

  return false;
}
