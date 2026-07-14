import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHappXrayCarrier } from '@modules/root/happ-xray';

const TEST_UUID = '11111111-1111-4111-8111-111111111111';
const OPTIONS = {
    tier: 'MAIN' as const,
    whitelistSuffix: ' [White Cipher]',
};

test('parseHappXrayCarrier groups and deduplicates resolved protocol outbounds', () => {
    const groups = parseHappXrayCarrier(
        [
            {
                outbounds: [vlessOutbound('xray'), hysteriaOutbound('hy2')],
                remarks: '⚡ Авто 1',
            },
            {
                outbounds: [vlessOutbound('renamed-xray'), hysteriaOutbound('renamed-hy2')],
                remarks: '⚡️ Авто 2',
            },
        ],
        OPTIONS,
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].groupName, '⚡ Авто');
    assert.equal(groups[0].tier, 'MAIN');
    assert.deepEqual(
        groups[0].candidates.map(({ protocol }) => protocol),
        ['vless', 'hysteria'],
    );
    assert.deepEqual(groups[0].candidates[1].outbound.streamSettings.hysteriaSettings, {
        auth: TEST_UUID,
        version: 2,
    });
});

test('parseHappXrayCarrier uses explicit source tier for the group name', () => {
    const groups = parseHappXrayCarrier(
        [{ outbounds: [vlessOutbound('xray')], remarks: '🇳🇱 Нидерланды 4' }],
        { tier: 'WL', whitelistSuffix: ' [White Cipher]' },
    );

    assert.equal(groups[0].tier, 'WL');
    assert.equal(groups[0].groupName, '🇳🇱 Нидерланды [White Cipher]');
});

test('parseHappXrayCarrier rejects a non-array carrier payload', () => {
    assert.throws(() => parseHappXrayCarrier('not-an-array', OPTIONS), {
        message: 'HAPP XRAY_JSON carrier payload must be an array.',
    });
});

test('parseHappXrayCarrier rejects unsupported protocols without exposing payload values', () => {
    assert.throws(
        () =>
            parseHappXrayCarrier(
                [
                    {
                        outbounds: [
                            {
                                password: 'super-secret',
                                protocol: 'trojan',
                                tag: 'proxy',
                            },
                        ],
                        remarks: '⚡ Авто 1',
                    },
                ],
                OPTIONS,
            ),
        (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /Invalid HAPP XRAY_JSON carrier\[0\]/);
            assert.doesNotMatch(error.message, /super-secret/);
            assert.doesNotMatch(error.message, /trojan/);
            return true;
        },
    );
});

test('parseHappXrayCarrier rejects malformed Hysteria without exposing auth', () => {
    const malformed = hysteriaOutbound('hy2');
    malformed.streamSettings.hysteriaSettings.version = 1;

    assert.throws(
        () => parseHappXrayCarrier([{ outbounds: [malformed], remarks: '⚡ Авто 1' }], OPTIONS),
        (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /Invalid HAPP XRAY_JSON carrier\[0\]/);
            assert.doesNotMatch(error.message, new RegExp(TEST_UUID));
            assert.doesNotMatch(error.message, /auth/);
            return true;
        },
    );
});

function vlessOutbound(tag: string) {
    return {
        mux: { concurrency: -1, enabled: false },
        protocol: 'vless',
        settings: {
            vnext: [
                {
                    address: 'auto.bridge.example',
                    port: 443,
                    users: [{ encryption: 'none', flow: 'xtls-rprx-vision', id: TEST_UUID }],
                },
            ],
        },
        streamSettings: {
            network: 'raw',
            realitySettings: {
                fingerprint: 'firefox',
                publicKey: 'PUBLIC_KEY',
                serverName: 'auto.bridge.example',
                shortId: 'abcdef1234567890',
            },
            security: 'reality',
        },
        tag,
    };
}

function hysteriaOutbound(tag: string) {
    return {
        protocol: 'hysteria',
        settings: {
            address: 'hy2.bridge.example',
            port: 12000,
            version: 2,
        },
        streamSettings: {
            hysteriaSettings: { auth: TEST_UUID, version: 2 },
            network: 'hysteria',
            security: 'tls',
            tlsSettings: {
                alpn: ['h3'],
                fingerprint: 'chrome',
                serverName: 'hy2.bridge.example',
            },
        },
        tag,
    };
}
