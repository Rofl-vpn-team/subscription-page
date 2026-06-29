# Happ Xray Burst Observatory Ping Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parameterize Happ Xray `burstObservatory.pingConfig` through subscription-page environment variables while preserving existing defaults and `HAPP_XRAY_OBSERVATORY_URL` compatibility.

**Architecture:** The backend config schema owns env parsing, defaulting, validation, and backward-compatible destination resolution. `RootService` reads a typed ping config once and passes it to the Happ Xray generator. The generator remains pure and emits the provided ping config only for balanced groups.

**Tech Stack:** NestJS backend, TypeScript, Zod config schema, Node test runner, `ts-node`, `tsconfig-paths`.

## Global Constraints

- Add explicit env variables for every `burstObservatory.pingConfig` field.
- Keep current defaults: `connectivity=''`, `destination=https://www.gstatic.com/generate_204`, `interval=2m`, `sampling=3`, `timeout=3s`.
- Keep `HAPP_XRAY_OBSERVATORY_URL` as a backward-compatible alias for destination.
- If both destination env vars are set, `HAPP_XRAY_BURST_OBSERVATORY_DESTINATION` wins.
- Single-outbound groups still omit `burstObservatory`.
- Run `npm run test:happ-xray` from `backend`.

---

## File Structure

- `backend/src/common/config/app-config/config.schema.ts`: parse and validate new env variables; resolve effective destination.
- `backend/src/modules/root/happ-xray/happ-xray.types.ts`: define reusable `HappXrayBurstObservatoryPingConfig` and add it to generator options.
- `backend/src/modules/root/happ-xray/happ-xray-config-generator.ts`: copy `options.burstObservatoryPingConfig` into generated configs.
- `backend/src/modules/root/root.service.ts`: read new config values and pass typed ping config to the generator.
- `backend/test/happ-xray/happ-xray-config-generator.test.ts`: verify custom ping config reaches generated balanced config.
- `backend/test/happ-xray/root-service-happ-xray.test.ts`: verify schema defaults, alias compatibility, new env values, and service output.
- `.env.sample`: document the new env variables.

---

### Task 1: Env Schema Contract

**Files:**
- Modify: `backend/src/common/config/app-config/config.schema.ts`
- Modify: `backend/test/happ-xray/root-service-happ-xray.test.ts`

**Interfaces:**
- Produces config keys:
  - `HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: string`
  - `HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: string`
  - `HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: string`
  - `HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: number`
  - `HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: string`
- Keeps existing key: `HAPP_XRAY_OBSERVATORY_URL: string`

- [ ] **Step 1: Write failing schema tests**

Add assertions to `configSchema parses Happ Xray defaults and string values` in `backend/test/happ-xray/root-service-happ-xray.test.ts`:

```ts
assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY, '');
assert.equal(
    defaultValues.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION,
    'https://www.gstatic.com/generate_204',
);
assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_INTERVAL, '2m');
assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_SAMPLING, 3);
assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT, '3s');
```

Extend the enabled parse object:

```ts
HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: 'https://connect.example/204',
HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://probe.example/new',
HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: '30s',
HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: '5',
HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: '1500ms',
```

Add enabled assertions:

```ts
assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY, 'https://connect.example/204');
assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION, 'https://probe.example/new');
assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_INTERVAL, '30s');
assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_SAMPLING, 5);
assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT, '1500ms');
```

Add alias assertions after enabled assertions:

```ts
const aliasOnly = configSchema.parse({
    HAPP_XRAY_OBSERVATORY_URL: 'https://probe.example/legacy',
    INTERNAL_JWT_SECRET: 'secret',
    REMNAWAVE_API_TOKEN: 'token',
    REMNAWAVE_PANEL_URL: 'https://panel.example',
}) as Record<string, unknown>;

assert.equal(
    aliasOnly.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION,
    'https://probe.example/legacy',
);

const newDestinationWins = configSchema.parse({
    HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://probe.example/new',
    HAPP_XRAY_OBSERVATORY_URL: 'https://probe.example/legacy',
    INTERNAL_JWT_SECRET: 'secret',
    REMNAWAVE_API_TOKEN: 'token',
    REMNAWAVE_PANEL_URL: 'https://panel.example',
}) as Record<string, unknown>;

assert.equal(
    newDestinationWins.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION,
    'https://probe.example/new',
);
```

Add invalid sampling assertion:

```ts
assert.equal(
    configSchema.safeParse({
        HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: '0',
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    }).success,
    false,
);
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
npm run test:happ-xray -- root-service-happ-xray.test.ts
```

Expected: FAIL because the new config keys are missing or unresolved.

- [ ] **Step 3: Implement schema parsing**

In `backend/src/common/config/app-config/config.schema.ts`, add helpers after `booleanString`:

```ts
const defaultableString = (def: string) =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val));

const optionalNonEmptyString = () =>
    z.preprocess((val) => (val === '' ? undefined : val), z.string().optional());

const positiveIntegerString = (def: string) =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val))
        .refine((val) => /^[1-9]\d*$/.test(val), 'Must be a positive integer.')
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().positive());
```

Add fields after `HAPP_XRAY_OBSERVATORY_URL`:

```ts
HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: z.string().default(''),
HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: optionalNonEmptyString(),
HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: defaultableString('2m'),
HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: positiveIntegerString('3'),
HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: defaultableString('3s'),
```

Update URL validation in `superRefine`:

```ts
const burstObservatoryDestination =
    data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION ?? data.HAPP_XRAY_OBSERVATORY_URL;

if (
    !burstObservatoryDestination.startsWith('http://') &&
    !burstObservatoryDestination.startsWith('https://')
) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HAPP_XRAY_BURST_OBSERVATORY_DESTINATION must start with http:// or https://',
        path: [
            data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION
                ? 'HAPP_XRAY_BURST_OBSERVATORY_DESTINATION'
                : 'HAPP_XRAY_OBSERVATORY_URL',
        ],
    });
}
```

Append object transform after `superRefine`:

```ts
.transform((data) => ({
    ...data,
    HAPP_XRAY_BURST_OBSERVATORY_DESTINATION:
        data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION ?? data.HAPP_XRAY_OBSERVATORY_URL,
}));
```

- [ ] **Step 4: Run schema test to verify it passes**

Run:

```bash
npm run test:happ-xray -- root-service-happ-xray.test.ts
```

Expected: PASS for schema assertions, with possible constructor failures from later tasks still to fix.

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/config/app-config/config.schema.ts backend/test/happ-xray/root-service-happ-xray.test.ts
git commit -m "feat: parse happ xray burst observatory ping env"
```

---

### Task 2: Generator Ping Config Option

**Files:**
- Modify: `backend/src/modules/root/happ-xray/happ-xray.types.ts`
- Modify: `backend/src/modules/root/happ-xray/happ-xray-config-generator.ts`
- Modify: `backend/test/happ-xray/happ-xray-config-generator.test.ts`

**Interfaces:**
- Consumes `HappXrayBurstObservatoryPingConfig` from `happ-xray.types.ts`.
- Produces `HappXrayGeneratorOptions.burstObservatoryPingConfig`.

- [ ] **Step 1: Write failing generator test**

Add a test to `backend/test/happ-xray/happ-xray-config-generator.test.ts` after the first generator test:

```ts
test('buildGroupedHappXrayConfigs uses supplied burst observatory ping config', () => {
    const configs = buildGroupedHappXrayConfigs([AUTO_1, AUTO_2].map(parseHappVlessLine), {
        burstObservatoryPingConfig: {
            connectivity: 'https://connect.example/204',
            destination: 'https://probe.example/204',
            interval: '45s',
            sampling: 7,
            timeout: '1200ms',
        },
        whitelistSuffix: ' [White Cipher]',
    });

    assert.deepEqual(configs[0].burstObservatory?.pingConfig, {
        connectivity: 'https://connect.example/204',
        destination: 'https://probe.example/204',
        interval: '45s',
        sampling: 7,
        timeout: '1200ms',
    });
});
```

Update existing generator test option objects from:

```ts
{
    observatoryUrl: 'https://www.gstatic.com/generate_204',
    whitelistSuffix: ' [White Cipher]',
}
```

to:

```ts
{
    burstObservatoryPingConfig: {
        connectivity: '',
        destination: 'https://www.gstatic.com/generate_204',
        interval: '2m',
        sampling: 3,
        timeout: '3s',
    },
    whitelistSuffix: ' [White Cipher]',
}
```

- [ ] **Step 2: Run generator test to verify it fails**

Run:

```bash
npm run test:happ-xray -- happ-xray-config-generator.test.ts
```

Expected: FAIL because `burstObservatoryPingConfig` is not part of the generator options and the generator still reads `observatoryUrl`.

- [ ] **Step 3: Implement generator option**

In `backend/src/modules/root/happ-xray/happ-xray.types.ts`, add:

```ts
export interface HappXrayBurstObservatoryPingConfig {
    connectivity: string;
    destination: string;
    interval: string;
    sampling: number;
    timeout: string;
}
```

Update `HappXrayGeneratorOptions`:

```ts
export interface HappXrayGeneratorOptions {
    burstObservatoryPingConfig: HappXrayBurstObservatoryPingConfig;
    whitelistSuffix: string;
}
```

Update `HappXrayConfig.burstObservatory.pingConfig`:

```ts
pingConfig: HappXrayBurstObservatoryPingConfig;
```

In `backend/src/modules/root/happ-xray/happ-xray-config-generator.ts`, replace the hardcoded `pingConfig` object with:

```ts
pingConfig: options.burstObservatoryPingConfig,
```

- [ ] **Step 4: Run generator test to verify it passes**

Run:

```bash
npm run test:happ-xray -- happ-xray-config-generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/root/happ-xray/happ-xray.types.ts backend/src/modules/root/happ-xray/happ-xray-config-generator.ts backend/test/happ-xray/happ-xray-config-generator.test.ts
git commit -m "feat: inject happ xray burst observatory ping config"
```

---

### Task 3: Root Service Wiring And Documentation

**Files:**
- Modify: `backend/src/modules/root/root.service.ts`
- Modify: `backend/test/happ-xray/root-service-happ-xray.test.ts`
- Modify: `.env.sample`

**Interfaces:**
- Consumes `ConfigSchema` keys produced by Task 1.
- Consumes `HappXrayGeneratorOptions.burstObservatoryPingConfig` produced by Task 2.
- Produces grouped Happ JSON where `burstObservatory.pingConfig` mirrors env config.

- [ ] **Step 1: Write failing root service test**

Add a test after `serveAggregatedHappConfig returns grouped Happ JSON config collection when grouped Xray flag is true`:

```ts
test('serveAggregatedHappConfig applies custom burst observatory ping config', async () => {
    const { res, service } = createService({
        HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: 'https://connect.example/204',
        HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://probe.example/204',
        HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: '45s',
        HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: 7,
        HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: '1200ms',
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
    });

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(configs[0].burstObservatory.pingConfig, {
        connectivity: 'https://connect.example/204',
        destination: 'https://probe.example/204',
        interval: '45s',
        sampling: 7,
        timeout: '1200ms',
    });
});
```

Extend `createService` defaults:

```ts
HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: '',
HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://www.gstatic.com/generate_204',
HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: '2m',
HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: 3,
HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: '3s',
```

- [ ] **Step 2: Run root service test to verify it fails**

Run:

```bash
npm run test:happ-xray -- root-service-happ-xray.test.ts
```

Expected: FAIL because `RootService` does not read or pass the new ping config yet.

- [ ] **Step 3: Implement RootService wiring**

In `backend/src/modules/root/root.service.ts`, update import:

```ts
import {
    buildGroupedHappXrayConfigs,
    HappXrayBurstObservatoryPingConfig,
    parseHappVlessLine,
} from './happ-xray';
```

Replace:

```ts
private readonly happXrayObservatoryUrl: string;
```

with:

```ts
private readonly happXrayBurstObservatoryPingConfig: HappXrayBurstObservatoryPingConfig;
```

Replace constructor reads for `HAPP_XRAY_OBSERVATORY_URL` with:

```ts
this.happXrayBurstObservatoryPingConfig = {
    connectivity: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY'),
    destination: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_DESTINATION'),
    interval: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_INTERVAL'),
    sampling: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_SAMPLING'),
    timeout: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT'),
};
```

Update generator call:

```ts
const configs = buildGroupedHappXrayConfigs(lines.map(parseHappVlessLine), {
    burstObservatoryPingConfig: this.happXrayBurstObservatoryPingConfig,
    whitelistSuffix: this.happXrayWhitelistSuffix,
});
```

- [ ] **Step 4: Document env variables**

In `.env.sample`, replace the Happ Xray block with:

```dotenv
# Experimental Happ Xray-compatible grouped JSON output
HAPP_XRAY_GROUPED_CONFIG_ENABLED=false
HAPP_XRAY_OBSERVATORY_URL=https://www.gstatic.com/generate_204
HAPP_XRAY_WHITELIST_SUFFIX=" [White Cipher]"
HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY=
HAPP_XRAY_BURST_OBSERVATORY_DESTINATION=
HAPP_XRAY_BURST_OBSERVATORY_INTERVAL=2m
HAPP_XRAY_BURST_OBSERVATORY_SAMPLING=3
HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT=3s
```

- [ ] **Step 5: Run root service test to verify it passes**

Run:

```bash
npm run test:happ-xray -- root-service-happ-xray.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full Happ Xray test suite**

Run:

```bash
npm run test:happ-xray
```

Expected: PASS with all Happ Xray tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/root/root.service.ts backend/test/happ-xray/root-service-happ-xray.test.ts .env.sample
git commit -m "feat: wire happ xray burst observatory ping env"
```
