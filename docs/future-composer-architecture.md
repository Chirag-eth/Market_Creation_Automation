# Future Composer Architecture

This project is moving toward a workflow-first structure so we can add:

- more leagues
- sub-leagues
- more market families
- more JSON output formats

without rewriting the UI every time.

## Workspace Model

The app should grow around three workspaces:

1. `Composer`
2. `Upcoming Fixtures`
3. `Verify`

### Composer

Primary payload-building workspace.

- fixture context
- market schema selection
- metadata overrides
- generated JSON outputs

### Upcoming Fixtures

Schedule-first browsing workspace.

- league family navigation
- sub-league navigation
- matchweek grouping
- fixture application into Composer

### Verify

Strict QA workspace.

- incoming JSON inputs
- grouped verification report
- CSV-backed validation

## Page Structure

### Header

- product title
- short summary
- theme toggle

### Workspace Rail

- `Composer`
- `Upcoming Fixtures`
- `Verify`

### Main Surface

Depends on active workspace:

- Composer: builder page
- Upcoming Fixtures: schedule browser
- Verify: inspection/review

## Component Hierarchy

### Shared

- `WorkspaceNav`
- `LeagueTabs`
- `MatchweekSelector`
- `ResultPanel`
- `JsonOutputPanel`

### Composer

- `MarketSchemaSelect`
- `MarketSchemaSummary`
- `FixtureContextCard`
- `MetadataPanel`
- `ComposerOutputPane`

### Upcoming Fixtures

- `LeagueRail`
- `MatchweekGroups`
- `FixtureCard`
- `FixtureSearch`

### Verify

- `VerifyInputs`
- `VerifySummary`
- `VerifySections`

## State Model

State should stay split by concern:

### Runtime

- deterministic reference time
- cached schedule snapshots
- network loading state

### Navigation

- active workspace
- active generate page
- selected league schedule code
- selected matchweek

### Composer

- selected market schema key
- selected fixture identity
- event name
- league selection
- type reference id
- metadata fields

### Verify

- fixture JSON input
- parent/submarket JSON input
- last verification report

## Schema Model

Each future market format should be described by a schema object instead of one-off UI code.

Schema responsibilities:

- key
- label
- short label
- category
- status
- description
- outputs
- required fields
- optional fields
- settlement scope

That lets us add future formats by data/config first, then bind generation logic only when the backend/output is ready.

## Migration Principle

Keep the current `full-time-1x2` flow working while treating it as the first active schema.

Future additions should follow this order:

1. add schema
2. add UI field mapping
3. add validation
4. add JSON builder

This keeps expansion incremental and safer.
