# Happ Xray Burst Observatory Ping Config

## Context

The subscription-page backend can return grouped Happ Xray-compatible JSON configs when
`HAPP_XRAY_GROUPED_CONFIG_ENABLED=true`. For groups with more than one outbound, the generator
emits `burstObservatory.pingConfig`, but most ping settings are currently hardcoded:

- `connectivity: ''`
- `destination: HAPP_XRAY_OBSERVATORY_URL`
- `interval: '2m'`
- `sampling: 3`
- `timeout: '3s'`

Operators need to tune the whole `pingConfig` from subscription-page environment variables without
changing generated config shape or breaking existing deployments.

## Design

Add explicit environment variables for every `burstObservatory.pingConfig` field:

- `HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY`, default `''`
- `HAPP_XRAY_BURST_OBSERVATORY_DESTINATION`, default `https://www.gstatic.com/generate_204`
- `HAPP_XRAY_BURST_OBSERVATORY_INTERVAL`, default `2m`
- `HAPP_XRAY_BURST_OBSERVATORY_SAMPLING`, default `3`
- `HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT`, default `3s`

Keep `HAPP_XRAY_OBSERVATORY_URL` as a backward-compatible alias for destination. If the new
destination variable is not set, the old variable continues to control `pingConfig.destination`.
If both are set, the new `HAPP_XRAY_BURST_OBSERVATORY_DESTINATION` value wins.

`RootService` will read the validated config values once at construction, build a typed
`HappXrayBurstObservatoryPingConfig`, and pass it to `buildGroupedHappXrayConfigs`. The generator
will copy that object into `burstObservatory.pingConfig` for balanced groups. Single-outbound
groups still omit `burstObservatory`, matching current behavior.

## Validation

The config schema will keep the existing URL validation for the effective destination. `sampling`
will parse from a string env value into a positive integer. The duration fields remain strings
because Happ/Xray duration formats are string-based and currently stored as strings.

## Testing

Add or update backend Happ Xray tests to cover:

- Generator uses a supplied custom `pingConfig`.
- Config schema preserves current defaults.
- Config schema accepts the new env variables and keeps `HAPP_XRAY_OBSERVATORY_URL` compatibility.
- Root service output includes custom `pingConfig` in grouped Happ JSON.

Run `npm run test:happ-xray` from `backend`.
