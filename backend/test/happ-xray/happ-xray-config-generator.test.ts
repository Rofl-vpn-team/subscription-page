import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildGroupedHappXrayConfigs,
    buildResolvedHappXrayConfigs,
    HappResolvedGroup,
    parseHappVlessLine,
} from '@modules/root/happ-xray';

const AUTO_1 =
    'vless://11111111-1111-4111-8111-111111111111@auto1.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto1.example&fp=firefox&pbk=PBK1&sid=1111111111111111#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';
const AUTO_2 =
    'vless://11111111-1111-4111-8111-111111111111@auto2.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto2.example&fp=firefox&pbk=PBK2&sid=2222222222222222#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%202';
const NL_1 =
    'vless://11111111-1111-4111-8111-111111111111@nl1.example:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=nl1.example&fp=firefox&pbk=PBK4&sid=4444444444444444#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B%201';
const RU_1 =
    'vless://11111111-1111-4111-8111-111111111111@ru1.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=ru1.example&fp=firefox&pbk=PBK5&sid=5555555555555555#%F0%9F%87%B7%F0%9F%87%BA%20%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F%201';
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

test('buildGroupedHappXrayConfigs resolves Russian resources through direct Yandex DNS', () => {
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(AUTO_1)],
        DEFAULT_GENERATOR_OPTIONS,
    );

    assert.deepEqual(configs[0].dns, {
        disableFallbackIfMatch: true,
        enableParallelQuery: true,
        queryStrategy: 'UseIPv4',
        servers: [
            {
                address: '77.88.8.8',
                domains: [
                    'geosite:category-ru',
                    'domain:ru',
                    'domain:xn--p1ai',
                    'domain:yandex.net',
                ],
            },
            {
                address: '77.88.8.1',
                domains: [
                    'geosite:category-ru',
                    'domain:ru',
                    'domain:xn--p1ai',
                    'domain:yandex.net',
                ],
            },
            'https://8.8.8.8/dns-query',
            'https://8.8.4.4/dns-query',
        ],
    });

    const dnsRuleIndex = configs[0].routing.rules.findIndex((rule) =>
        rule.ip?.includes('77.88.8.8'),
    );
    const proxyRuleIndex = configs[0].routing.rules.findIndex(
        (rule) => rule.balancerTag || rule.outboundTag?.startsWith('out_'),
    );

    assert.notEqual(dnsRuleIndex, -1);
    assert.ok(dnsRuleIndex < proxyRuleIndex);
    assert.deepEqual(configs[0].routing.rules[dnsRuleIndex], {
        ip: ['77.88.8.8', '77.88.8.1'],
        outboundTag: 'direct',
        type: 'field',
    });
});

test('HAPP generators route the server public-tracker category directly before proxy rules', () => {
    const groupedConfigs = buildGroupedHappXrayConfigs(
        [AUTO_1, RU_1, WL_AUTO].map(parseHappVlessLine),
        DEFAULT_GENERATOR_OPTIONS,
    );
    const resolvedConfigs = buildResolvedHappXrayConfigs(
        [resolvedGroup('MAIN', '⚡ Авто', ['vless', 'hysteria'])],
        DEFAULT_GENERATOR_OPTIONS,
    );
    const expectedTrackerRule = {
        domain: ['geosite:category-public-tracker'],
        outboundTag: 'direct',
        type: 'field' as const,
    };

    for (const config of [...groupedConfigs, ...resolvedConfigs]) {
        const bittorrentRuleIndex = config.routing.rules.findIndex((rule) =>
            rule.protocol?.includes('bittorrent'),
        );
        const trackerRuleIndex = config.routing.rules.findIndex((rule) =>
            rule.domain?.includes('geosite:category-public-tracker'),
        );
        const firstProxyRuleIndex = config.routing.rules.findIndex(
            (rule) =>
                rule.network !== undefined &&
                (rule.balancerTag !== undefined || rule.outboundTag?.startsWith('out_')),
        );

        assert.notEqual(bittorrentRuleIndex, -1);
        assert.notEqual(trackerRuleIndex, -1);
        assert.notEqual(firstProxyRuleIndex, -1);
        assert.ok(bittorrentRuleIndex < trackerRuleIndex);
        assert.ok(trackerRuleIndex < firstProxyRuleIndex);
        assert.deepEqual(config.routing.rules[trackerRuleIndex], expectedTrackerRule);
    }
});

test('buildGroupedHappXrayConfigs routes Russian sites and IPs directly before proxy catch-all', () => {
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(AUTO_1)],
        DEFAULT_GENERATOR_OPTIONS,
    );

    assert.deepEqual(configs[0].routing.rules[0], {
        outboundTag: 'direct',
        protocol: ['bittorrent'],
        type: 'field',
    });
    assert.deepEqual(configs[0].routing.rules[1], {
        domain: ['geosite:category-public-tracker'],
        outboundTag: 'direct',
        type: 'field',
    });
    assert.deepEqual(configs[0].routing.rules[2], {
        ip: ['77.88.8.8', '77.88.8.1'],
        outboundTag: 'direct',
        type: 'field',
    });
    assert.equal(configs[0].routing.rules[3].outboundTag, 'direct');
    assert.equal(configs[0].routing.rules[3].type, 'field');
    assert.ok(configs[0].routing.rules[3].domain?.includes('domain:ru'));
    assert.ok(configs[0].routing.rules[3].domain?.includes('geosite:category-ru'));
    assert.ok(configs[0].routing.rules[3].domain?.includes('domain:yandex'));
    assert.ok(configs[0].routing.rules[3].domain?.includes('domain:kontur.host'));
    assert.deepEqual(configs[0].routing.rules[4], {
        ip: ['geoip:ru'],
        outboundTag: 'direct',
        type: 'field',
    });
    assert.deepEqual(configs[0].routing.rules[5], {
        network: 'tcp',
        outboundTag: 'out_MAIN_0_1',
        type: 'field',
    });
});

test('buildGroupedHappXrayConfigs sends Russian profile sites through VPN', () => {
    const configs = buildGroupedHappXrayConfigs(
        [parseHappVlessLine(RU_1)],
        DEFAULT_GENERATOR_OPTIONS,
    );

    assert.equal(configs[0].remarks, '🇷🇺 Россия');
    assert.deepEqual(configs[0].routing.rules, [
        {
            outboundTag: 'direct',
            protocol: ['bittorrent'],
            type: 'field',
        },
        {
            domain: ['geosite:category-public-tracker'],
            outboundTag: 'direct',
            type: 'field',
        },
        {
            ip: ['77.88.8.8', '77.88.8.1'],
            outboundTag: 'direct',
            type: 'field',
        },
        {
            network: 'tcp',
            outboundTag: 'out_MAIN_0_1',
            type: 'field',
        },
    ]);
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

test('buildResolvedHappXrayConfigs routes TCP to Xray and UDP to Hysteria with opposite fallback', () => {
    const config = buildResolvedHappXrayConfigs(
        [resolvedGroup('MAIN', '⚡ Авто', ['vless', 'hysteria'])],
        DEFAULT_GENERATOR_OPTIONS,
    )[0];
    const balancers = new Map(
        config.routing.balancers?.map((balancer) => [balancer.tag, balancer]),
    );

    assert.deepEqual(balancers.get('balancer_MAIN_0_tcp_primary')?.selector, ['out_MAIN_0_xray_']);
    assert.equal(
        balancers.get('balancer_MAIN_0_tcp_primary')?.fallbackTag,
        'loop_MAIN_0_tcp_to_hy2',
    );
    assert.deepEqual(balancers.get('balancer_MAIN_0_udp_primary')?.selector, ['out_MAIN_0_hy2_']);
    assert.equal(
        balancers.get('balancer_MAIN_0_udp_primary')?.fallbackTag,
        'loop_MAIN_0_udp_to_xray',
    );
    assert.equal(balancers.get('balancer_MAIN_0_tcp_fallback')?.fallbackTag, 'block');
    assert.equal(balancers.get('balancer_MAIN_0_udp_fallback')?.fallbackTag, 'block');
    assert.deepEqual(config.burstObservatory?.subjectSelector, [
        'out_MAIN_0_xray_',
        'out_MAIN_0_hy2_',
    ]);

    assert.deepEqual(
        config.outbounds.filter((outbound) => outbound.protocol === 'loopback'),
        [
            {
                protocol: 'loopback',
                settings: { inboundTag: 'fallback_MAIN_0_tcp_to_hy2' },
                tag: 'loop_MAIN_0_tcp_to_hy2',
            },
            {
                protocol: 'loopback',
                settings: { inboundTag: 'fallback_MAIN_0_udp_to_xray' },
                tag: 'loop_MAIN_0_udp_to_xray',
            },
        ],
    );
    assert.deepEqual(config.routing.rules.slice(0, 2), [
        {
            balancerTag: 'balancer_MAIN_0_tcp_fallback',
            inboundTag: ['fallback_MAIN_0_tcp_to_hy2'],
            type: 'field',
        },
        {
            balancerTag: 'balancer_MAIN_0_udp_fallback',
            inboundTag: ['fallback_MAIN_0_udp_to_xray'],
            type: 'field',
        },
    ]);
    assert.deepEqual(config.routing.rules.slice(-2), [
        {
            balancerTag: 'balancer_MAIN_0_udp_primary',
            network: 'udp',
            type: 'field',
        },
        {
            balancerTag: 'balancer_MAIN_0_tcp_primary',
            network: 'tcp',
            type: 'field',
        },
    ]);
});

test('buildResolvedHappXrayConfigs uses one fail-closed Xray balancer when Hysteria is absent', () => {
    const config = buildResolvedHappXrayConfigs(
        [resolvedGroup('MAIN', '🇳🇱 Нидерланды', ['vless'])],
        DEFAULT_GENERATOR_OPTIONS,
    )[0];

    assert.deepEqual(
        config.routing.balancers?.map((balancer) => balancer.tag),
        ['balancer_MAIN_0_xray_only'],
    );
    assert.equal(config.routing.balancers?.[0].fallbackTag, 'block');
    assert.deepEqual(config.routing.rules.slice(-2), [
        { balancerTag: 'balancer_MAIN_0_xray_only', network: 'udp', type: 'field' },
        { balancerTag: 'balancer_MAIN_0_xray_only', network: 'tcp', type: 'field' },
    ]);
    assert.deepEqual(config.burstObservatory?.subjectSelector, ['out_MAIN_0_xray_']);
});

test('buildResolvedHappXrayConfigs uses one fail-closed Hysteria balancer when Xray is absent', () => {
    const config = buildResolvedHappXrayConfigs(
        [resolvedGroup('WL', '⚡ Авто [White Cipher]', ['hysteria'])],
        DEFAULT_GENERATOR_OPTIONS,
    )[0];

    assert.deepEqual(
        config.routing.balancers?.map((balancer) => balancer.tag),
        ['balancer_WL_0_hy2_only'],
    );
    assert.equal(config.routing.balancers?.[0].fallbackTag, 'block');
    assert.deepEqual(config.routing.rules.slice(-2), [
        { balancerTag: 'balancer_WL_0_hy2_only', network: 'udp', type: 'field' },
        { balancerTag: 'balancer_WL_0_hy2_only', network: 'tcp', type: 'field' },
    ]);
    assert.deepEqual(config.burstObservatory?.subjectSelector, ['out_WL_0_hy2_']);
});

test('buildResolvedHappXrayConfigs skips empty country groups', () => {
    const emptyGroup: HappResolvedGroup = {
        candidates: [],
        groupName: '🇩🇪 Германия',
        tier: 'MAIN',
    };

    assert.deepEqual(buildResolvedHappXrayConfigs([emptyGroup], DEFAULT_GENERATOR_OPTIONS), []);
});

function resolvedGroup(
    tier: HappResolvedGroup['tier'],
    groupName: string,
    protocols: Array<'vless' | 'hysteria'>,
): HappResolvedGroup {
    return {
        candidates: protocols.map((protocol, index) => ({
            identity: `${protocol}-${index}`,
            outbound:
                protocol === 'vless'
                    ? {
                          protocol,
                          settings: {
                              vnext: [
                                  {
                                      address: `${groupName}-${index}.xray.example`,
                                      port: 443,
                                      users: [{ id: '11111111-1111-4111-8111-111111111111' }],
                                  },
                              ],
                          },
                          streamSettings: { network: 'raw', security: 'reality' },
                          tag: `source-xray-${index}`,
                      }
                    : {
                          protocol,
                          settings: {
                              address: `${groupName}-${index}.hy2.example`,
                              port: 12000,
                              version: 2,
                          },
                          streamSettings: {
                              hysteriaSettings: {
                                  auth: '11111111-1111-4111-8111-111111111111',
                                  version: 2,
                              },
                              network: 'hysteria',
                              security: 'tls',
                          },
                          tag: `source-hy2-${index}`,
                      },
            protocol,
        })),
        groupName,
        tier,
    };
}
