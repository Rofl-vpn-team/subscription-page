import type { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import assert from 'node:assert/strict';
import test from 'node:test';

import { configSchema, TypedConfigService } from '@common/config/app-config';
import { AxiosService } from '@common/axios/axios.service';

import { SubpageConfigService } from '@modules/root/subpage-config.service';
import { RootService } from '@modules/root/root.service';

const MAIN_LINK =
    'vless://11111111-1111-4111-8111-111111111111@main.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=main.example&fp=firefox&pbk=PBK1&sid=1111111111111111#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';
const FALLBACK_LINK =
    'vless://22222222-2222-4222-8222-222222222222@fallback.example:443?encryption=none&type=raw&security=reality&sni=fallback.example&fp=firefox&pbk=PBK2&sid=2222222222222222#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%202';
const DEV_TCP_WHITE_CIPHER_LINK =
    'vless://22222222-2222-4222-8222-222222222222@85.198.97.235:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=ya.ru&fp=firefox&pbk=PBK2&sid=2222222222222222#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B%201%20%5BWhite%20Cipher%5D%';
const TEST_HYSTERIA_AUTH = '33333333-3333-4333-8333-333333333333';

test('serveAggregatedHappConfig keeps base64 merge when grouped Xray flag is false', async () => {
    const { axios, res, service } = createService({ HAPP_XRAY_GROUPED_CONFIG_ENABLED: false });

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, encodeLines([MAIN_LINK, FALLBACK_LINK]));
    assert.equal(res.headers['content-type'], 'text/plain');
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType, shortUuid, withClientType }) => ({
            clientType,
            shortUuid,
            withClientType,
        })),
        [
            { clientType: undefined, shortUuid: 'main-short', withClientType: false },
            { clientType: undefined, shortUuid: 'fallback-short', withClientType: false },
        ],
    );
});

test('serveAggregatedHappConfig returns grouped Happ JSON config collection when grouped Xray flag is true', async () => {
    const { res, service } = createService({ HAPP_XRAY_GROUPED_CONFIG_ENABLED: true });

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(
        configs.map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто'],
    );
    assert.equal(configs[0].routing.balancers[0].tag, 'balancer_MAIN_0');
    assert.equal(configs[0].routing.rules.at(-1).balancerTag, 'balancer_MAIN_0');
    assert.equal(
        configs[0].burstObservatory.pingConfig.destination,
        'https://www.gstatic.com/generate_204',
    );
});

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

test('serveAggregatedHappConfig falls back to base64 when grouped Xray build fails', async () => {
    const grpcFallback = FALLBACK_LINK.replace('&type=raw', '&type=grpc');
    const { logger, res, service } = createService(
        { HAPP_XRAY_GROUPED_CONFIG_ENABLED: true },
        { fallbackPayload: encodeLines([grpcFallback]) },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, encodeLines([MAIN_LINK, grpcFallback]));
    assert.equal(res.headers['content-type'], 'text/plain');
    assert.equal(logger.warns.length, 1);
    assert.doesNotMatch(logger.warns[0], /11111111-1111-4111-8111-111111111111/);
    assert.doesNotMatch(logger.warns[0], /22222222-2222-4222-8222-222222222222/);
    assert.doesNotMatch(logger.warns[0], /PBK/);
});

test('serveAggregatedHappConfig returns JSON for dev tcp links with malformed trailing remark percent', async () => {
    const tcpMain = MAIN_LINK.replace('&type=raw', '&type=tcp');
    const { logger, res, service } = createService(
        { HAPP_XRAY_GROUPED_CONFIG_ENABLED: true },
        {
            fallbackPayload: encodeLines([DEV_TCP_WHITE_CIPHER_LINK]),
            mainPayload: encodeLines([tcpMain]),
        },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(logger.warns.length, 0);

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(
        configs.flatMap((config: { outbounds: Array<{ streamSettings?: { network: string } }> }) =>
            config.outbounds
                .filter((outbound) => outbound.streamSettings)
                .map((outbound) => outbound.streamSettings?.network),
        ),
        ['tcp', 'tcp'],
    );
    assert.deepEqual(
        configs.map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто', '🇳🇱 Нидерланды [White Cipher]'],
    );
});

test('serveAggregatedHappConfig returns grouped Xray JSON when no fallback short uuid exists', async () => {
    const { res, service } = createService(
        { HAPP_XRAY_GROUPED_CONFIG_ENABLED: true },
        { fallbackShortUuid: null },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(
        configs.map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто'],
    );
});

test('serveAggregatedHappConfig returns grouped Xray JSON when fallback subscription is unavailable', async () => {
    const { res, service } = createService(
        { HAPP_XRAY_GROUPED_CONFIG_ENABLED: true },
        { fallbackPayload: null },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(
        configs.map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто'],
    );
});

test('serveAggregatedHappConfig uses resolved Xray JSON for an allowlisted Hysteria cohort', async () => {
    const { axios, logger, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ALLOWLIST: ' main-short ',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
        },
        {
            fallbackXrayJsonPayload: createCarrier('⚡ Авто 2', 'fallback'),
            mainXrayJsonPayload: createCarrier('⚡ Авто 1', 'main'),
        },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType, shortUuid, withClientType }) => ({
            clientType,
            shortUuid,
            withClientType,
        })),
        [
            { clientType: 'v2ray-json', shortUuid: 'main-short', withClientType: true },
            { clientType: 'v2ray-json', shortUuid: 'fallback-short', withClientType: true },
        ],
    );

    const configs = JSON.parse(res.body as string);

    assert.deepEqual(
        configs.map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто', '⚡ Авто [White Cipher]'],
    );
    for (const config of configs) {
        assert.equal(
            config.routing.rules.some(
                (rule: { balancerTag?: string; network?: string }) =>
                    rule.network === 'tcp' && rule.balancerTag?.endsWith('_tcp_primary'),
            ),
            true,
        );
        assert.equal(
            config.routing.rules.some(
                (rule: { balancerTag?: string; network?: string }) =>
                    rule.network === 'udp' && rule.balancerTag?.endsWith('_udp_primary'),
            ),
            true,
        );
    }

    assert.doesNotMatch(logger.output.join('\n'), /main-short|fallback-short/);
    assert.doesNotMatch(logger.output.join('\n'), new RegExp(TEST_HYSTERIA_AUTH));
    assert.doesNotMatch(logger.output.join('\n'), /11111111-1111-4111-8111-111111111111/);
});

test('AxiosService forwards Happ HWID as x-hwid to Remnawave subscriptions', async () => {
    const service = new AxiosService(
        new StubConfigService({
            REMNAWAVE_API_TOKEN: 'token',
            REMNAWAVE_PANEL_URL: 'https://panel.example',
        }) as never,
    );
    let capturedHeaders: Record<string, unknown> = {};

    service.axiosInstance.request = (async (config: { headers?: Record<string, unknown> }) => {
        capturedHeaders = config.headers ?? {};
        return { data: [], headers: {} };
    }) as never;

    await service.getSubscription(
        '127.0.0.1',
        'main-short',
        { hwid: 'happ-device-id', 'user-agent': 'Happ/2.17.1' },
        true,
        'v2ray-json',
    );

    assert.equal(capturedHeaders['x-hwid'], 'happ-device-id');
    assert.equal(capturedHeaders.hwid, undefined);
});

test('serveAggregatedHappConfig atomically falls back to raw Xray when a carrier is malformed', async () => {
    const { axios, logger, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ALLOWLIST: 'main-short',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
        },
        {
            fallbackXrayJsonPayload: [{ outbounds: [{ protocol: 'hysteria' }], remarks: 'bad' }],
            mainXrayJsonPayload: createCarrier('⚡ Авто 1', 'main'),
        },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    const fallbackConfigs = JSON.parse(res.body as string);

    assert.equal(
        fallbackConfigs
            .flatMap((config: { outbounds: Array<{ protocol: string }> }) =>
                config.outbounds.map(({ protocol }) => protocol),
            )
            .includes('hysteria'),
        false,
    );
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType }) => clientType),
        ['v2ray-json', 'v2ray-json', undefined, undefined],
    );
    assert.equal(
        logger.warns.some((message) => message.includes('event=happ_hysteria_generation_fallback')),
        true,
    );
    assert.doesNotMatch(logger.output.join('\n'), /main-short|fallback-short/);
    assert.doesNotMatch(logger.output.join('\n'), new RegExp(TEST_HYSTERIA_AUTH));
});

test('serveAggregatedHappConfig returns main-only resolved JSON when typed fallback is unavailable', async () => {
    const { axios, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ALLOWLIST: 'main-short',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
        },
        {
            fallbackXrayJsonPayload: null,
            mainXrayJsonPayload: createCarrier('⚡ Авто 1', 'main'),
        },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(
        JSON.parse(res.body as string).map((config: { remarks: string }) => config.remarks),
        ['⚡ Авто'],
    );
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType }) => clientType),
        ['v2ray-json', 'v2ray-json'],
    );
});

test('serveAggregatedHappConfig redacts identifiers when fallback lookup is unavailable', async () => {
    const { logger, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ALLOWLIST: 'main-short',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
        },
        {
            mainUserFound: false,
            mainXrayJsonPayload: createCarrier('⚡ Авто 1', 'main'),
        },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.doesNotMatch(logger.output.join('\n'), /main-short|fallback-short/);
});

test('serveAggregatedHappConfig falls back to raw Xray when typed main is unavailable', async () => {
    const { axios, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ALLOWLIST: 'main-short',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
        },
        { mainXrayJsonPayload: null },
    );

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    const fallbackConfigs = JSON.parse(res.body as string);

    assert.equal(
        fallbackConfigs
            .flatMap((config: { outbounds: Array<{ protocol: string }> }) =>
                config.outbounds.map(({ protocol }) => protocol),
            )
            .includes('hysteria'),
        false,
    );
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType }) => clientType),
        ['v2ray-json', undefined, undefined],
    );
});

test('serveAggregatedMihomoConfig stays Mihomo-only when Happ Hysteria rollout is on', async () => {
    const { axios, res, service } = createService(
        {
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: true,
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'on',
        },
        {
            mainMihomoPayload: [
                'proxies:',
                '  - name: xray-main',
                '    type: vless',
                'proxy-groups:',
                '  - name: VPN',
                '    type: select',
                '    use:',
                '      - main-provider',
                '      - fallback-provider',
            ].join('\n'),
        },
    );

    await service.serveAggregatedMihomoConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(
        axios.subscriptionCalls.map(({ clientType, withClientType }) => ({
            clientType,
            withClientType,
        })),
        [{ clientType: 'mihomo', withClientType: true }],
    );
    assert.match(res.body as string, /main-provider:/);
    assert.match(res.body as string, /fallback-provider:/);
    assert.doesNotMatch(res.body as string, /hysteria|hy2/i);
});

test('serveAggregatedMihomoConfig carries Happ HWID into provider headers', async () => {
    const { res, service } = createService(
        { HAPP_XRAY_GROUPED_CONFIG_ENABLED: true },
        {
            mainMihomoPayload: [
                'proxies: []',
                'proxy-groups:',
                '  - name: VPN',
                '    type: select',
                '    use:',
                '      - main-provider',
                '      - fallback-provider',
            ].join('\n'),
        },
    );

    await service.serveAggregatedMihomoConfig(
        '127.0.0.1',
        createReq({ hwid: 'happ-device-id' }),
        res as never,
        'main-short',
    );

    assert.match(res.body as string, /x-hwid:\n\s+- happ-device-id/);
});

test('configSchema parses Happ Xray defaults and string values', () => {
    const defaults = configSchema.parse({
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    });

    const defaultValues = defaults as Record<string, unknown>;

    assert.equal(defaultValues.HAPP_XRAY_GROUPED_CONFIG_ENABLED, false);
    assert.equal(defaultValues.HAPP_XRAY_HYSTERIA_ALLOWLIST, '');
    assert.equal(defaultValues.HAPP_XRAY_HYSTERIA_ROLLOUT_MODE, 'off');
    assert.equal(defaultValues.HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT, 0);
    assert.equal(defaultValues.HAPP_XRAY_OBSERVATORY_URL, 'https://www.gstatic.com/generate_204');
    assert.equal(defaultValues.HAPP_XRAY_WHITELIST_SUFFIX, ' [White Cipher]');
    assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY, '');
    assert.equal(
        defaultValues.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION,
        'https://www.gstatic.com/generate_204',
    );
    assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_INTERVAL, '2m');
    assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_SAMPLING, 3);
    assert.equal(defaultValues.HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT, '3s');

    const enabled = configSchema.parse({
        HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: 'https://connect.example/204',
        HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://probe.example/new',
        HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: '30s',
        HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: '5',
        HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: '1500ms',
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'true',
        HAPP_XRAY_HYSTERIA_ALLOWLIST: 'main-short, another-short',
        HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'percentage',
        HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT: '25',
        HAPP_XRAY_OBSERVATORY_URL: 'http://probe.example/status',
        HAPP_XRAY_WHITELIST_SUFFIX: ' [Allow]',
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    });

    const enabledValues = enabled as Record<string, unknown>;

    assert.equal(enabledValues.HAPP_XRAY_GROUPED_CONFIG_ENABLED, true);
    assert.equal(enabledValues.HAPP_XRAY_HYSTERIA_ALLOWLIST, 'main-short, another-short');
    assert.equal(enabledValues.HAPP_XRAY_HYSTERIA_ROLLOUT_MODE, 'percentage');
    assert.equal(enabledValues.HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT, 25);
    assert.equal(enabledValues.HAPP_XRAY_OBSERVATORY_URL, 'http://probe.example/status');
    assert.equal(enabledValues.HAPP_XRAY_WHITELIST_SUFFIX, ' [Allow]');
    assert.equal(
        enabledValues.HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY,
        'https://connect.example/204',
    );
    assert.equal(
        enabledValues.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION,
        'https://probe.example/new',
    );
    assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_INTERVAL, '30s');
    assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_SAMPLING, 5);
    assert.equal(enabledValues.HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT, '1500ms');

    const aliasOnly = configSchema.parse({
        HAPP_XRAY_OBSERVATORY_URL: 'https://probe.example/legacy',
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    }) as Record<string, unknown>;

    assert.equal(aliasOnly.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION, 'https://probe.example/legacy');

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

    assert.equal(
        configSchema.safeParse({
            HAPP_XRAY_OBSERVATORY_URL: 'ftp://probe.example/status',
            INTERNAL_JWT_SECRET: 'secret',
            REMNAWAVE_API_TOKEN: 'token',
            REMNAWAVE_PANEL_URL: 'https://panel.example',
        }).success,
        false,
    );
    assert.equal(
        configSchema.safeParse({
            HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: '0',
            INTERNAL_JWT_SECRET: 'secret',
            REMNAWAVE_API_TOKEN: 'token',
            REMNAWAVE_PANEL_URL: 'https://panel.example',
        }).success,
        false,
    );

    for (const mode of ['allowlist', 'percentage', 'on']) {
        assert.equal(
            configSchema.safeParse({
                HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'true',
                HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: mode,
                INTERNAL_JWT_SECRET: 'secret',
                REMNAWAVE_API_TOKEN: 'token',
                REMNAWAVE_PANEL_URL: 'https://panel.example',
            }).success,
            true,
        );
    }

    for (const percentage of ['-1', '101', '1.5', 'not-a-number']) {
        assert.equal(
            configSchema.safeParse({
                HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'true',
                HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT: percentage,
                INTERNAL_JWT_SECRET: 'secret',
                REMNAWAVE_API_TOKEN: 'token',
                REMNAWAVE_PANEL_URL: 'https://panel.example',
            }).success,
            false,
        );
    }

    assert.equal(
        configSchema.safeParse({
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'true',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'invalid',
            INTERNAL_JWT_SECRET: 'secret',
            REMNAWAVE_API_TOKEN: 'token',
            REMNAWAVE_PANEL_URL: 'https://panel.example',
        }).success,
        false,
    );
    assert.equal(
        configSchema.safeParse({
            HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'false',
            HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'allowlist',
            INTERNAL_JWT_SECRET: 'secret',
            REMNAWAVE_API_TOKEN: 'token',
            REMNAWAVE_PANEL_URL: 'https://panel.example',
        }).success,
        false,
    );
});

function createService(
    configOverrides: Record<string, unknown>,
    subscriptionOverrides: {
        fallbackPayload?: string | null;
        fallbackShortUuid?: string | null;
        fallbackXrayJsonPayload?: unknown | null;
        mainPayload?: string;
        mainMihomoPayload?: unknown;
        mainUserFound?: boolean;
        mainXrayJsonPayload?: unknown | null;
    } = {},
) {
    const config = new StubConfigService({
        HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: '',
        HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: 'https://www.gstatic.com/generate_204',
        HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: '2m',
        HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: 3,
        HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: '3s',
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: false,
        HAPP_XRAY_HYSTERIA_ALLOWLIST: '',
        HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: 'off',
        HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT: 0,
        HAPP_XRAY_OBSERVATORY_URL: 'https://www.gstatic.com/generate_204',
        HAPP_XRAY_WHITELIST_SUFFIX: ' [White Cipher]',
        MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS: false,
        MARZBAN_LEGACY_LINK_ENABLED: false,
        SUBSCRIPTION_PUBLIC_BASE_URL: 'https://sub.example',
        ...configOverrides,
    });
    const axios = new StubAxiosService({
        fallbackPayload:
            subscriptionOverrides.fallbackPayload === undefined
                ? encodeLines([FALLBACK_LINK])
                : subscriptionOverrides.fallbackPayload,
        fallbackShortUuid:
            subscriptionOverrides.fallbackShortUuid === undefined
                ? 'fallback-short'
                : subscriptionOverrides.fallbackShortUuid,
        fallbackXrayJsonPayload:
            subscriptionOverrides.fallbackXrayJsonPayload === undefined
                ? createCarrier('⚡ Авто 2', 'fallback')
                : subscriptionOverrides.fallbackXrayJsonPayload,
        mainPayload: subscriptionOverrides.mainPayload ?? encodeLines([MAIN_LINK]),
        mainMihomoPayload:
            subscriptionOverrides.mainMihomoPayload ?? 'proxies: []\nproxy-groups: []',
        mainUserFound: subscriptionOverrides.mainUserFound ?? true,
        mainXrayJsonPayload:
            subscriptionOverrides.mainXrayJsonPayload === undefined
                ? createCarrier('⚡ Авто 1', 'main')
                : subscriptionOverrides.mainXrayJsonPayload,
    });
    const logger = new CapturingLogger();
    const typedConfig = new TypedConfigService(config as never);
    const service = new RootService(
        typedConfig,
        { sign: () => 'jwt' } as never,
        axios as unknown as AxiosService,
        { getEncryptedSubpageConfigUuid: () => 'encrypted' } as unknown as SubpageConfigService,
    );

    Object.defineProperty(service, 'logger', { value: logger });

    return { axios, logger, res: createRes(), service };
}

function createReq(headers: NodeJS.Dict<string | string[]> = {}) {
    return {
        headers,
    } as never;
}

interface StubResponse {
    body: unknown;
    headers: Record<string, unknown>;
    setHeader: (key: string, value: unknown) => void;
    status: (code: number) => StubResponse;
    statusCode?: number;
    send: (body: unknown) => StubResponse;
}

function createRes(): StubResponse {
    return {
        body: undefined as unknown,
        headers: {} as Record<string, unknown>,
        setHeader(key: string, value: unknown) {
            this.headers[key.toLowerCase()] = value;
        },
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        statusCode: undefined as number | undefined,
        send(body: unknown) {
            this.body = body;
            return this;
        },
    };
}

function encodeLines(lines: string[]): string {
    return Buffer.from(lines.join('\n'), 'utf-8').toString('base64');
}

class StubConfigService {
    public constructor(private readonly values: Record<string, unknown>) {}

    public get<T>(key: string): T | undefined {
        return this.values[key] as T | undefined;
    }

    public getOrThrow<T>(key: string): T {
        if (!(key in this.values)) {
            throw new Error(`Missing config ${key}`);
        }

        return this.values[key] as T;
    }
}

class StubAxiosService {
    public readonly subscriptionCalls: SubscriptionCall[] = [];

    public constructor(
        private readonly payloads: {
            fallbackPayload: string | null;
            fallbackShortUuid: string | null;
            fallbackXrayJsonPayload: unknown | null;
            mainPayload: string;
            mainMihomoPayload: unknown;
            mainUserFound: boolean;
            mainXrayJsonPayload: unknown | null;
        },
    ) {}

    public async getSubscription(
        _clientIp: string,
        shortUuid: string,
        _headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean = false,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<{ headers: Record<string, string>; response: unknown } | null> {
        this.subscriptionCalls.push({ clientType, shortUuid, withClientType });

        const isMain = shortUuid === 'main-short';
        const response =
            clientType === 'v2ray-json'
                ? isMain
                    ? this.payloads.mainXrayJsonPayload
                    : this.payloads.fallbackXrayJsonPayload
                : clientType === 'mihomo'
                  ? this.payloads.mainMihomoPayload
                  : isMain
                    ? this.payloads.mainPayload
                    : this.payloads.fallbackPayload;

        if (response === null) {
            return null;
        }

        return {
            headers: { 'content-type': 'text/plain' },
            response,
        };
    }

    public async getUserByShortUuid(_clientIp: string, shortUuid: string) {
        if (shortUuid === 'main-short') {
            if (!this.payloads.mainUserFound) {
                return { isOk: false };
            }

            return {
                isOk: true,
                response: {
                    description: JSON.stringify({
                        ...(this.payloads.fallbackShortUuid
                            ? { fallbackShortUuid: this.payloads.fallbackShortUuid }
                            : {}),
                        role: 'main',
                    }),
                },
            };
        }

        return {
            isOk: true,
            response: { description: null },
        };
    }
}

class CapturingLogger {
    public output: string[] = [];
    public warns: string[] = [];

    public debug(message: string): void {
        this.output.push(message);
    }

    public error(message: string): void {
        this.output.push(message);
    }

    public log(message: string): void {
        this.output.push(message);
    }

    public warn(message: string): void {
        this.warns.push(message);
        this.output.push(message);
    }
}

interface SubscriptionCall {
    clientType?: TRequestTemplateTypeKeys;
    shortUuid: string;
    withClientType: boolean;
}

function createCarrier(remarks: string, host: string) {
    return [
        {
            outbounds: [
                {
                    protocol: 'vless',
                    settings: {
                        vnext: [
                            {
                                address: `${host}-xray.example`,
                                port: 443,
                                users: [{ id: '11111111-1111-4111-8111-111111111111' }],
                            },
                        ],
                    },
                    streamSettings: { network: 'raw', security: 'reality' },
                    tag: `${host}-xray`,
                },
                {
                    protocol: 'hysteria',
                    settings: {
                        address: `${host}-hy2.example`,
                        port: 12_000,
                        version: 2,
                    },
                    streamSettings: {
                        hysteriaSettings: { auth: TEST_HYSTERIA_AUTH, version: 2 },
                        network: 'hysteria',
                        security: 'tls',
                        tlsSettings: { serverName: `${host}-hy2.example` },
                    },
                    tag: `${host}-hy2`,
                },
            ],
            remarks,
        },
    ];
}
