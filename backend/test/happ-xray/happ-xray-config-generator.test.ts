import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGroupedHappXrayConfig, parseHappVlessLine } from '../../src/modules/root/happ-xray';

const AUTO_1 =
    'vless://11111111-1111-4111-8111-111111111111@auto1.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto1.example&fp=firefox&pbk=PBK1&sid=1111111111111111#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';
const AUTO_2 =
    'vless://11111111-1111-4111-8111-111111111111@auto2.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto2.example&fp=firefox&pbk=PBK2&sid=2222222222222222#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%202';
const WL_AUTO =
    'vless://22222222-2222-4222-8222-222222222222@wl-auto.example:443?encryption=none&type=raw&security=reality&sni=wl-auto.example&fp=firefox&pbk=PBK3&sid=3333333333333333#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201%20%5BWhite%20Cipher%5D';

test('buildGroupedHappXrayConfig emits leastPing balancers and observatory', () => {
    const config = buildGroupedHappXrayConfig(
        [AUTO_1, AUTO_2, WL_AUTO].map(parseHappVlessLine),
        {
            observatoryUrl: 'https://www.gstatic.com/generate_204',
            whitelistSuffix: ' [White Cipher]',
        },
    );

    assert.equal(config.outbounds.length, 3);
    assert.deepEqual(
        config.outbounds.map((outbound) => outbound.tag),
        ['out_MAIN_0_1', 'out_MAIN_0_2', 'out_WL_1_1'],
    );
    assert.deepEqual(
        config.routing.balancers.map((balancer) => balancer.tag),
        ['balancer_MAIN_0', 'balancer_WL_1'],
    );
    assert.deepEqual(config.routing.balancers[0].selector, ['out_MAIN_0_']);
    assert.deepEqual(config.routing.balancers[0].strategy, { type: 'leastPing' });
    assert.deepEqual(config.routing.rules, []);
    assert.deepEqual(config.observatory.subjectSelector, ['out_']);
    assert.equal(config.observatory.probeUrl, 'https://www.gstatic.com/generate_204');
});

test('buildGroupedHappXrayConfig maps VLESS REALITY fields into streamSettings', () => {
    const config = buildGroupedHappXrayConfig([parseHappVlessLine(AUTO_1)], {
        observatoryUrl: 'https://www.gstatic.com/generate_204',
        whitelistSuffix: ' [White Cipher]',
    });
    const outbound = config.outbounds[0];

    assert.equal(outbound.protocol, 'vless');
    assert.equal(outbound.settings.address, 'auto1.example');
    assert.equal(outbound.settings.port, 443);
    assert.equal(outbound.settings.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(outbound.settings.encryption, 'none');
    assert.equal(outbound.settings.flow, 'xtls-rprx-vision');
    assert.equal(outbound.streamSettings.network, 'raw');
    assert.equal(outbound.streamSettings.security, 'reality');
    assert.deepEqual(outbound.streamSettings.realitySettings, {
        fingerprint: 'firefox',
        password: 'PBK1',
        serverName: 'auto1.example',
        shortId: '1111111111111111',
    });
    assert.equal('publicKey' in outbound.streamSettings.realitySettings!, false);
});

test('buildGroupedHappXrayConfig accepts tcp VLESS transport from Remnawave links', () => {
    const tcpAuto = AUTO_1.replace('&type=raw', '&type=tcp');
    const config = buildGroupedHappXrayConfig([parseHappVlessLine(tcpAuto)], {
        observatoryUrl: 'https://www.gstatic.com/generate_204',
        whitelistSuffix: ' [White Cipher]',
    });

    assert.equal(config.outbounds[0].streamSettings.network, 'tcp');
});

test('buildGroupedHappXrayConfig rejects REALITY links missing required pbk', () => {
    const missingPbk = AUTO_1.replace('&pbk=PBK1', '');

    assert.throws(
        () =>
            buildGroupedHappXrayConfig([parseHappVlessLine(missingPbk)], {
                observatoryUrl: 'https://www.gstatic.com/generate_204',
                whitelistSuffix: ' [White Cipher]',
            }),
        /Missing required REALITY field "pbk" for outbound out_MAIN_0_1 \(auto1\.example\)/,
    );
});

test('buildGroupedHappXrayConfig rejects unsupported non-raw transports', () => {
    const grpcLink = AUTO_1.replace('&type=raw', '&type=grpc');

    assert.throws(
        () =>
            buildGroupedHappXrayConfig([parseHappVlessLine(grpcLink)], {
                observatoryUrl: 'https://www.gstatic.com/generate_204',
                whitelistSuffix: ' [White Cipher]',
            }),
        /Unsupported VLESS transport "grpc" for outbound out_MAIN_0_1 \(auto1\.example\)/,
    );
});
