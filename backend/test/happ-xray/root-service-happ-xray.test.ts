import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';

import { AxiosService } from '../../src/common/axios/axios.service';
import { configSchema } from '../../src/common/config/app-config/config.schema';
import { RootService } from '../../src/modules/root/root.service';
import { SubpageConfigService } from '../../src/modules/root/subpage-config.service';

const MAIN_LINK =
    'vless://11111111-1111-4111-8111-111111111111@main.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=main.example&fp=firefox&pbk=PBK1&sid=1111111111111111#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';
const FALLBACK_LINK =
    'vless://22222222-2222-4222-8222-222222222222@fallback.example:443?encryption=none&type=raw&security=reality&sni=fallback.example&fp=firefox&pbk=PBK2&sid=2222222222222222#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%202';
const DEV_TCP_WHITE_CIPHER_LINK =
    'vless://22222222-2222-4222-8222-222222222222@85.198.97.235:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=ya.ru&fp=firefox&pbk=PBK2&sid=2222222222222222#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B%201%20%5BWhite%20Cipher%5D%';

test('serveAggregatedHappConfig keeps base64 merge when grouped Xray flag is false', async () => {
    const { res, service } = createService({ HAPP_XRAY_GROUPED_CONFIG_ENABLED: false });

    await service.serveAggregatedHappConfig('127.0.0.1', createReq(), res as never, 'main-short');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, encodeLines([MAIN_LINK, FALLBACK_LINK]));
    assert.equal(res.headers['content-type'], 'text/plain');
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
    assert.equal(configs[0].burstObservatory.pingConfig.destination, 'https://www.gstatic.com/generate_204');
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

test('configSchema parses Happ Xray defaults and string values', () => {
    const defaults = configSchema.parse({
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    });

    const defaultValues = defaults as Record<string, unknown>;

    assert.equal(defaultValues.HAPP_XRAY_GROUPED_CONFIG_ENABLED, false);
    assert.equal(defaultValues.HAPP_XRAY_OBSERVATORY_URL, 'https://www.gstatic.com/generate_204');
    assert.equal(defaultValues.HAPP_XRAY_WHITELIST_SUFFIX, ' [White Cipher]');

    const enabled = configSchema.parse({
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: 'true',
        HAPP_XRAY_OBSERVATORY_URL: 'http://probe.example/status',
        HAPP_XRAY_WHITELIST_SUFFIX: ' [Allow]',
        INTERNAL_JWT_SECRET: 'secret',
        REMNAWAVE_API_TOKEN: 'token',
        REMNAWAVE_PANEL_URL: 'https://panel.example',
    });

    const enabledValues = enabled as Record<string, unknown>;

    assert.equal(enabledValues.HAPP_XRAY_GROUPED_CONFIG_ENABLED, true);
    assert.equal(enabledValues.HAPP_XRAY_OBSERVATORY_URL, 'http://probe.example/status');
    assert.equal(enabledValues.HAPP_XRAY_WHITELIST_SUFFIX, ' [Allow]');

    assert.equal(
        configSchema.safeParse({
            HAPP_XRAY_OBSERVATORY_URL: 'ftp://probe.example/status',
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
        mainPayload?: string;
    } = {},
) {
    const config = new StubConfigService({
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: false,
        HAPP_XRAY_OBSERVATORY_URL: 'https://www.gstatic.com/generate_204',
        HAPP_XRAY_WHITELIST_SUFFIX: ' [White Cipher]',
        MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS: false,
        MARZBAN_LEGACY_LINK_ENABLED: false,
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
        mainPayload: subscriptionOverrides.mainPayload ?? encodeLines([MAIN_LINK]),
    });
    const logger = new CapturingLogger();
    const service = new RootService(
        config as unknown as ConfigService,
        { sign: () => 'jwt' } as never,
        axios as unknown as AxiosService,
        { getEncryptedSubpageConfigUuid: () => 'encrypted' } as unknown as SubpageConfigService,
    );

    Object.defineProperty(service, 'logger', { value: logger });

    return { logger, res: createRes(), service };
}

function createReq() {
    return {
        headers: {},
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
    public constructor(
        private readonly payloads: {
            fallbackPayload: string | null;
            fallbackShortUuid: string | null;
            mainPayload: string;
        },
    ) {}

    public async getSubscription(
        _clientIp: string,
        shortUuid: string,
    ): Promise<{ headers: Record<string, string>; response: string } | null> {
        const response =
            shortUuid === 'main-short' ? this.payloads.mainPayload : this.payloads.fallbackPayload;

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
    public warns: string[] = [];

    public debug(): void {}

    public error(): void {}

    public log(): void {}

    public warn(message: string): void {
        this.warns.push(message);
    }
}
