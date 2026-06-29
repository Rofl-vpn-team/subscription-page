import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGroupedHappXrayConfigs, parseHappVlessLine } from '../../src/modules/root/happ-xray';

const AUTO_1 =
    'vless://11111111-1111-4111-8111-111111111111@auto1.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto1.example&fp=firefox&pbk=PBK1&sid=1111111111111111#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';
const AUTO_2 =
    'vless://11111111-1111-4111-8111-111111111111@auto2.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto2.example&fp=firefox&pbk=PBK2&sid=2222222222222222#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%202';
const NL_1 =
    'vless://11111111-1111-4111-8111-111111111111@nl1.example:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=nl1.example&fp=firefox&pbk=PBK4&sid=4444444444444444#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B%201';
const WL_AUTO =
    'vless://22222222-2222-4222-8222-222222222222@wl-auto.example:443?encryption=none&type=raw&security=reality&sni=wl-auto.example&fp=firefox&pbk=PBK3&sid=3333333333333333#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201%20%5BWhite%20Cipher%5D';

const DEFAULT_GENERATOR_OPTIONS = {
    burstObservatoryPingConfig: {
        connectivity: '',
        destination: 'https://www.gstatic.com/generate_204',
        interval: '2m',
        sampling: 3,
        timeout: '3s',
    },
    whitelistSuffix: ' [White Cipher]',
};

test('buildGroupedHappXrayConfigs emits one top-level Happ config per visible group', () => {
    const configs = buildGroupedHappXrayConfigs(
        [AUTO_1, AUTO_2, NL_1, WL_AUTO].map(parseHappVlessLine),
        DEFAULT_GENERATOR_OPTIONS,
    );

    assert.deepEqual(
        configs.map((config) => config.remarks),
        ['⚡ Авто', '🇳🇱 Нидерланды', '⚡ Авто [White Cipher]'],
    );
    assert.equal(configs[0].routing.balancers?.[0].tag, 'balancer_MAIN_0');
    assert.equal(configs[0].routing.balancers?.[0].strategy.type, 'leastLoad');
    assert.deepEqual(configs[0].routing.balancers?.[0].strategy.settings, {
        baselines: ['200ms', '500ms'],
        expected: 7,
        maxRTT: '2500ms',
        tolerance: 0,
    });
    assert.equal(configs[0].routing.rules.at(-1)?.balancerTag, 'balancer_MAIN_0');
    assert.deepEqual(configs[0].burstObservatory?.subjectSelector, ['out_MAIN_0_']);
    assert.equal(configs[1].routing.balancers, undefined);
    assert.equal(configs[1].routing.rules.at(-1)?.outboundTag, 'out_MAIN_1_1');
});

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

test('buildGroupedHappXrayConfigs routes Russian sites directly before proxy catch-all', () => {
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(AUTO_1)],
        DEFAULT_GENERATOR_OPTIONS,
    );

    assert.deepEqual(configs[0].routing.rules[0], {
        outboundTag: 'direct',
        protocol: ['bittorrent'],
        type: 'field',
    });
    assert.equal(configs[0].routing.rules[1].outboundTag, 'direct');
    assert.equal(configs[0].routing.rules[1].type, 'field');
    assert.ok(configs[0].routing.rules[1].domain?.includes('domain:ru'));
    assert.ok(configs[0].routing.rules[1].domain?.includes('geosite:category-ru'));
    assert.ok(configs[0].routing.rules[1].domain?.includes('domain:yandex'));
    assert.ok(configs[0].routing.rules[1].domain?.includes('domain:kontur.host'));
    assert.deepEqual(configs[0].routing.rules[2], {
        network: 'tcp',
        outboundTag: 'out_MAIN_0_1',
        type: 'field',
    });
});

test('buildGroupedHappXrayConfigs maps VLESS REALITY fields into Happ-compatible vnext streamSettings', () => {
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(AUTO_1)],
        DEFAULT_GENERATOR_OPTIONS,
    );
    const outbound = configs[0].outbounds[0];

    assert.equal(outbound.protocol, 'vless');
    assert.deepEqual(outbound.settings.vnext, [
        {
            address: 'auto1.example',
            port: 443,
            users: [
                {
                    encryption: 'none',
                    flow: 'xtls-rprx-vision',
                    id: '11111111-1111-4111-8111-111111111111',
                    level: 8,
                },
            ],
        },
    ]);
    assert.equal(outbound.streamSettings.network, 'raw');
    assert.equal(outbound.streamSettings.security, 'reality');
    assert.deepEqual(outbound.streamSettings.realitySettings, {
        allowInsecure: false,
        fingerprint: 'firefox',
        publicKey: 'PBK1',
        serverName: 'auto1.example',
        shortId: '1111111111111111',
        show: false,
    });
    assert.equal('password' in outbound.streamSettings.realitySettings!, false);
});

test('buildGroupedHappXrayConfigs accepts tcp VLESS transport from Remnawave links', () => {
    const tcpAuto = AUTO_1.replace('&type=raw', '&type=tcp');
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(tcpAuto)],
        DEFAULT_GENERATOR_OPTIONS,
    );

    const outbound = configs[0].outbounds.find((item) => item.protocol === 'vless');

    assert.equal(outbound?.streamSettings.network, 'tcp');
});

test('buildGroupedHappXrayConfigs rejects REALITY links missing required pbk', () => {
    const missingPbk = AUTO_1.replace('&pbk=PBK1', '');

    assert.throws(
        () =>
            buildGroupedHappXrayConfigs(
                [parseHappVlessLine(missingPbk)],
                DEFAULT_GENERATOR_OPTIONS,
            ),
        /Missing required REALITY field "pbk" for outbound out_MAIN_0_1 \(auto1\.example\)/,
    );
});

test('buildGroupedHappXrayConfigs rejects unsupported non-raw transports', () => {
    const grpcLink = AUTO_1.replace('&type=raw', '&type=grpc');

    assert.throws(
        () =>
            buildGroupedHappXrayConfigs([parseHappVlessLine(grpcLink)], DEFAULT_GENERATOR_OPTIONS),
        /Unsupported VLESS transport "grpc" for outbound out_MAIN_0_1 \(auto1\.example\)/,
    );
});
