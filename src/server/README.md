# Server MVC Extraction

This directory contains the incremental MVC decomposition of `server.js`.

## Current structure

- `routes/`: route-level dispatch modules (HTTP path handling)
- `services/`: pure domain/service logic reused by handlers

## Modules extracted so far

- `routes/docsRoutes.js`
  - Handles `/api/openapi.json`, `/api/openapi.yaml`, `/api/docs`
- `services/batchResolutionService.js`
  - `resolveBatchLeague`
  - `resolveBatchTeam`

## Migration strategy

1. Keep behavior stable in `server.js`
2. Extract pure logic to `services/` first
3. Extract path-specific handling to `routes/`
4. Introduce controller modules where handlers share request/response orchestration
