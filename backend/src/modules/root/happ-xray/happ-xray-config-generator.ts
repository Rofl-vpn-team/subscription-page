import {
    HappGroup,
    HappParsedVlessLink,
    HappResolvedGroup,
    HappResolvedProxyOutbound,
    HappXrayConfig,
    HappXrayGeneratorOptions,
    HappXrayOutbound,
    HappXrayProxyOutbound,
} from './happ-xray.types';
import { groupHappLinks } from './happ-xray-grouping';

const RUSSIAN_DIRECT_DOMAINS = [
    'domain:ru',
    'domain:xn--p1ai',
    'geosite:category-ru',
    'domain:1cfresh.com',
    'domain:2gis.by',
    'domain:2gis.com',
    'domain:2gis.com.cy',
    'domain:alfa-bank.com',
    'domain:alfabank.com',
    'domain:alfafinance.biz',
    'domain:alfafx.com',
    'domain:alfaprivate.com',
    'domain:beta-bank.com',
    'domain:gazprombank.tech',
    'domain:investalfabank.com',
    'domain:moex.com',
    'domain:tochka.com',
    'domain:tochka-tech.com',
    'domain:vtb.com',
    'domain:vtb.digital',
    'domain:vtb.promo',
    'domain:vtb24.com',
    'domain:vtbrussia.com',
    'domain:avito.st',
    'domain:lenta.com',
    'domain:megamarket.tech',
    'domain:okko.tv',
    'domain:ozonusercontent.com',
    'domain:premier.one',
    'domain:wildberries.by',
    'domain:wbstatic.net',
    'domain:youla.io',
    'domain:userapi.com',
    'domain:vk.com',
    'domain:vk-portal.net',
    'domain:yads.tech',
    'domain:yandex',
    'domain:yandex.ru',
    'domain:yandex-bank.net',
    'domain:yandex.aero',
    'domain:yandex.az',
    'domain:yandex.by',
    'domain:yandex.cloud',
    'domain:yandex.co.il',
    'domain:yandex.com',
    'domain:yandex.com.ge',
    'domain:yandex.eu',
    'domain:yandex.fr',
    'domain:yandex.jobs',
    'domain:yandex.kg',
    'domain:yandex.kz',
    'domain:yandex.net',
    'domain:yandex.org',
    'domain:yandexadexchange.net',
    'domain:yandexcloud.net',
    'domain:yandexcom.net',
    'domain:yandexmetrica.com',
    'domain:yandexwebcache.net',
    'domain:yandexwebcache.org',
    'domain:yastat.net',
    'domain:yastatic.net',
    'domain:gismeteo.com',
    'domain:lmru.tech',
    'domain:mradx.net',
    'domain:tildaapi.com',
    'domain:kontur.host',
];

const RUSSIAN_DIRECT_IPS = ['geoip:ru'];
const PUBLIC_TRACKER_DOMAINS = ['geosite:category-public-tracker'];
const RUSSIAN_DNS_DOMAINS = [
    'geosite:category-ru',
    'domain:ru',
    'domain:xn--p1ai',
    'domain:yandex.net',
];
const YANDEX_DNS_DIRECT_IPS = ['77.88.8.8', '77.88.8.1'];
const RUSSIAN_PROFILE_PREFIX = '\u{1F1F7}\u{1F1FA} \u0420\u043E\u0441\u0441\u0438\u044F';

export function buildGroupedHappXrayConfigs(
    links: HappParsedVlessLink[],
    options: HappXrayGeneratorOptions,
): HappXrayConfig[] {
    return groupHappLinks(links, { whitelistSuffix: options.whitelistSuffix }).map((group) =>
        buildProfileConfig(group, options),
    );
}

export function buildResolvedHappXrayConfigs(
    groups: HappResolvedGroup[],
    options: HappXrayGeneratorOptions,
): HappXrayConfig[] {
    return groups
        .filter((group) => group.candidates.length > 0)
        .map((group, groupIndex) => buildResolvedProfileConfig(group, groupIndex, options));
}

function buildProfileConfig(group: HappGroup, options: HappXrayGeneratorOptions): HappXrayConfig {
    const proxyOutbounds = group.candidates.map((candidate) =>
        buildProxyOutbound(candidate.outboundTag, candidate.link),
    );
    const proxyTags = proxyOutbounds.map((outbound) => outbound.tag);
    const hasBalancer = proxyTags.length > 1;
    const proxyRule = hasBalancer
        ? {
              balancerTag: group.balancerTag,
              network: 'tcp',
              type: 'field' as const,
          }
        : {
              network: 'tcp',
              outboundTag: proxyTags[0],
              type: 'field' as const,
          };
    return {
        ...(hasBalancer
            ? {
                  burstObservatory: {
                      pingConfig: options.burstObservatoryPingConfig,
                      subjectSelector: [group.selectorPrefix],
                  },
              }
            : {}),
        dns: buildDns(),
        inbounds: buildInbounds(),
        outbounds: [...proxyOutbounds, buildDirectOutbound(), buildBlockOutbound()],
        remarks: group.groupName,
        routing: {
            ...(hasBalancer
                ? {
                      balancers: [
                          buildLeastLoadBalancer(
                              group.balancerTag,
                              group.selectorPrefix,
                              proxyTags[0],
                          ),
                      ],
                  }
                : {}),
            domainMatcher: 'hybrid',
            domainStrategy: 'IPIfNonMatch',
            rules: [...buildDirectRoutingRules(group.groupName), proxyRule],
        },
    };
}

function buildResolvedProfileConfig(
    group: HappResolvedGroup,
    groupIndex: number,
    options: HappXrayGeneratorOptions,
): HappXrayConfig {
    const tagBase = `${group.tier}_${groupIndex}`;
    const xrayPrefix = `out_${tagBase}_xray_`;
    const hysteriaPrefix = `out_${tagBase}_hy2_`;
    const xrayOutbounds = group.candidates
        .filter((candidate) => candidate.protocol === 'vless')
        .map((candidate, index) =>
            normalizeResolvedVlessOutbound(candidate.outbound, `${xrayPrefix}${index + 1}`),
        );
    const hysteriaOutbounds = group.candidates
        .filter((candidate) => candidate.protocol === 'hysteria')
        .map((candidate, index) => ({
            ...candidate.outbound,
            tag: `${hysteriaPrefix}${index + 1}`,
        }));
    const hasXray = xrayOutbounds.length > 0;
    const hasHysteria = hysteriaOutbounds.length > 0;
    const topology =
        hasXray && hasHysteria
            ? buildDualProtocolTopology(tagBase, xrayPrefix, hysteriaPrefix)
            : buildSingleProtocolTopology(
                  tagBase,
                  hasXray ? 'xray' : 'hy2',
                  hasXray ? xrayPrefix : hysteriaPrefix,
              );

    return {
        burstObservatory: {
            pingConfig: options.burstObservatoryPingConfig,
            subjectSelector: topology.subjectSelectors,
        },
        dns: buildDns(),
        inbounds: buildInbounds(),
        outbounds: [
            ...xrayOutbounds,
            ...hysteriaOutbounds,
            ...topology.loopbackOutbounds,
            buildDirectOutbound(),
            buildBlockOutbound(),
        ],
        remarks: group.groupName,
        routing: {
            balancers: topology.balancers,
            domainMatcher: 'hybrid',
            domainStrategy: 'IPIfNonMatch',
            rules: [
                ...topology.loopbackRules,
                ...buildDirectRoutingRules(group.groupName),
                ...topology.proxyRules,
            ],
        },
    };
}

interface ResolvedTopology {
    balancers: NonNullable<HappXrayConfig['routing']['balancers']>;
    loopbackOutbounds: HappXrayOutbound[];
    loopbackRules: HappXrayConfig['routing']['rules'];
    proxyRules: HappXrayConfig['routing']['rules'];
    subjectSelectors: string[];
}

function buildDualProtocolTopology(
    tagBase: string,
    xrayPrefix: string,
    hysteriaPrefix: string,
): ResolvedTopology {
    const tcpLoopbackTag = `loop_${tagBase}_tcp_to_hy2`;
    const udpLoopbackTag = `loop_${tagBase}_udp_to_xray`;
    const tcpFallbackInboundTag = `fallback_${tagBase}_tcp_to_hy2`;
    const udpFallbackInboundTag = `fallback_${tagBase}_udp_to_xray`;
    const tcpPrimaryTag = `balancer_${tagBase}_tcp_primary`;
    const udpPrimaryTag = `balancer_${tagBase}_udp_primary`;
    const tcpFallbackTag = `balancer_${tagBase}_tcp_fallback`;
    const udpFallbackTag = `balancer_${tagBase}_udp_fallback`;

    return {
        balancers: [
            buildLeastLoadBalancer(tcpPrimaryTag, xrayPrefix, tcpLoopbackTag),
            buildLeastLoadBalancer(udpPrimaryTag, hysteriaPrefix, udpLoopbackTag),
            buildLeastLoadBalancer(tcpFallbackTag, hysteriaPrefix, 'block'),
            buildLeastLoadBalancer(udpFallbackTag, xrayPrefix, 'block'),
        ],
        loopbackOutbounds: [
            {
                protocol: 'loopback',
                settings: { inboundTag: tcpFallbackInboundTag },
                tag: tcpLoopbackTag,
            },
            {
                protocol: 'loopback',
                settings: { inboundTag: udpFallbackInboundTag },
                tag: udpLoopbackTag,
            },
        ],
        loopbackRules: [
            {
                balancerTag: tcpFallbackTag,
                inboundTag: [tcpFallbackInboundTag],
                type: 'field',
            },
            {
                balancerTag: udpFallbackTag,
                inboundTag: [udpFallbackInboundTag],
                type: 'field',
            },
        ],
        proxyRules: [
            {
                balancerTag: udpPrimaryTag,
                network: 'udp',
                type: 'field',
            },
            {
                balancerTag: tcpPrimaryTag,
                network: 'tcp',
                type: 'field',
            },
        ],
        subjectSelectors: [xrayPrefix, hysteriaPrefix],
    };
}

function buildSingleProtocolTopology(
    tagBase: string,
    protocolTag: 'xray' | 'hy2',
    selectorPrefix: string,
): ResolvedTopology {
    const balancerTag = `balancer_${tagBase}_${protocolTag}_only`;

    return {
        balancers: [buildLeastLoadBalancer(balancerTag, selectorPrefix, 'block')],
        loopbackOutbounds: [],
        loopbackRules: [],
        proxyRules: [
            {
                balancerTag,
                network: 'udp',
                type: 'field',
            },
            {
                balancerTag,
                network: 'tcp',
                type: 'field',
            },
        ],
        subjectSelectors: [selectorPrefix],
    };
}

function buildLeastLoadBalancer(
    tag: string,
    selectorPrefix: string,
    fallbackTag: string,
): NonNullable<HappXrayConfig['routing']['balancers']>[number] {
    return {
        fallbackTag,
        selector: [selectorPrefix],
        strategy: {
            settings: {
                baselines: ['200ms', '500ms'],
                expected: 7,
                maxRTT: '2500ms',
                tolerance: 0,
            },
            type: 'leastLoad',
        },
        tag,
    };
}

function buildDns(): HappXrayConfig['dns'] {
    return {
        disableFallbackIfMatch: true,
        enableParallelQuery: true,
        queryStrategy: 'UseIPv4',
        servers: [
            {
                address: '77.88.8.8',
                domains: RUSSIAN_DNS_DOMAINS,
            },
            {
                address: '77.88.8.1',
                domains: RUSSIAN_DNS_DOMAINS,
            },
            'https://8.8.8.8/dns-query',
            'https://8.8.4.4/dns-query',
        ],
    };
}

function buildDirectRoutingRules(groupName: string): HappXrayConfig['routing']['rules'] {
    const directRussianResourceRules = isRussianProfile({ groupName })
        ? []
        : [
              {
                  domain: RUSSIAN_DIRECT_DOMAINS,
                  outboundTag: 'direct',
                  type: 'field' as const,
              },
              {
                  ip: RUSSIAN_DIRECT_IPS,
                  outboundTag: 'direct',
                  type: 'field' as const,
              },
          ];

    return [
        {
            outboundTag: 'direct',
            protocol: ['bittorrent'],
            type: 'field',
        },
        {
            domain: PUBLIC_TRACKER_DOMAINS,
            outboundTag: 'direct',
            type: 'field',
        },
        {
            ip: YANDEX_DNS_DIRECT_IPS,
            outboundTag: 'direct',
            type: 'field',
        },
        ...directRussianResourceRules,
    ];
}

function isRussianProfile(group: Pick<HappGroup, 'groupName'>): boolean {
    return group.groupName
        .replace(/\uFE0F/g, '')
        .trim()
        .startsWith(RUSSIAN_PROFILE_PREFIX);
}

function buildInbounds(): HappXrayConfig['inbounds'] {
    return [
        {
            listen: '127.0.0.1',
            port: 10808,
            protocol: 'socks',
            settings: {
                auth: 'noauth',
                udp: true,
                userLevel: 8,
            },
            sniffing: {
                destOverride: ['http', 'tls'],
                enabled: true,
                routeOnly: false,
            },
            tag: 'socks',
        },
        {
            listen: '127.0.0.1',
            port: 10809,
            protocol: 'http',
            settings: {
                userLevel: 8,
            },
            tag: 'http',
        },
    ];
}

function buildProxyOutbound(tag: string, link: HappParsedVlessLink): HappXrayProxyOutbound {
    const realitySettings = buildRealitySettings(tag, link);
    const network = link.query.type ?? 'raw';
    const flow = normalizeHappVlessFlow(link.query.flow);

    if (network !== 'raw' && network !== 'tcp') {
        throw new Error(
            `Unsupported VLESS transport "${network}" for outbound ${tag} (${link.address})`,
        );
    }

    return {
        mux: {
            concurrency: -1,
            enabled: false,
        },
        protocol: 'vless',
        settings: {
            vnext: [
                {
                    address: link.address,
                    port: link.port,
                    users: [
                        {
                            encryption: link.query.encryption ?? 'none',
                            ...(typeof flow === 'string' && flow.length > 0 ? { flow } : {}),
                            id: link.id,
                            level: 8,
                        },
                    ],
                },
            ],
        },
        streamSettings: {
            network,
            ...(realitySettings ? { realitySettings } : {}),
            security: link.query.security ?? 'none',
            ...(network === 'tcp'
                ? {
                      tcpSettings: {
                          header: {
                              type: 'none' as const,
                          },
                      },
                  }
                : {}),
        },
        tag,
    };
}

function normalizeResolvedVlessOutbound(
    outbound: HappResolvedProxyOutbound,
    tag: string,
): HappResolvedProxyOutbound {
    const vnext = outbound.settings.vnext as unknown[];

    return {
        ...outbound,
        settings: {
            ...outbound.settings,
            vnext: vnext.map((server) => {
                if (server === null || typeof server !== 'object' || Array.isArray(server)) {
                    return server;
                }

                const serverRecord = server as Record<string, unknown>;

                if (!Array.isArray(serverRecord.users)) {
                    return { ...serverRecord };
                }

                return {
                    ...serverRecord,
                    users: serverRecord.users.map((user) => {
                        if (user === null || typeof user !== 'object' || Array.isArray(user)) {
                            return user;
                        }

                        const userRecord = user as Record<string, unknown>;
                        const flow = normalizeHappVlessFlow(userRecord.flow);

                        return flow === userRecord.flow
                            ? { ...userRecord }
                            : { ...userRecord, flow };
                    }),
                };
            }),
        },
        tag,
    };
}

function normalizeHappVlessFlow(flow: unknown): unknown {
    return flow === 'xtls-rprx-vision' ? 'xtls-rprx-vision-udp443' : flow;
}

function buildDirectOutbound(): HappXrayOutbound {
    return {
        protocol: 'freedom',
        settings: {
            domainStrategy: 'UseIP',
        },
        tag: 'direct',
    };
}

function buildBlockOutbound(): HappXrayOutbound {
    return {
        protocol: 'blackhole',
        settings: {
            response: {
                type: 'http',
            },
        },
        tag: 'block',
    };
}

function buildRealitySettings(
    tag: string,
    link: HappParsedVlessLink,
): HappXrayProxyOutbound['streamSettings']['realitySettings'] {
    if (link.query.security !== 'reality') {
        return undefined;
    }

    for (const field of ['fp', 'pbk', 'sni'] as const) {
        if (!link.query[field]) {
            throw new Error(
                `Missing required REALITY field "${field}" for outbound ${tag} (${link.address})`,
            );
        }
    }

    return {
        allowInsecure: false,
        fingerprint: link.query.fp,
        publicKey: link.query.pbk,
        serverName: link.query.sni,
        ...(link.query.sid ? { shortId: link.query.sid } : {}),
        show: false,
        ...(link.query.spx ? { spiderX: link.query.spx } : {}),
    };
}
