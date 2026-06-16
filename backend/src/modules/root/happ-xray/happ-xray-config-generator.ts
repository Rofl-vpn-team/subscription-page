import {
    HappGroup,
    HappParsedVlessLink,
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

export function buildGroupedHappXrayConfigs(
    links: HappParsedVlessLink[],
    options: HappXrayGeneratorOptions,
): HappXrayConfig[] {
    return groupHappLinks(links, { whitelistSuffix: options.whitelistSuffix }).map((group) =>
        buildProfileConfig(group, options),
    );
}

function buildProfileConfig(group: HappGroup, options: HappXrayGeneratorOptions): HappXrayConfig {
    const proxyOutbounds = group.candidates.map((candidate) =>
        buildProxyOutbound(candidate.outboundTag, candidate.link),
    );
    const proxyTags = proxyOutbounds.map((outbound) => outbound.tag);
    const hasBalancer = proxyTags.length > 1;

    return {
        ...(hasBalancer
            ? {
                  burstObservatory: {
                      pingConfig: {
                          connectivity: '',
                          destination: options.observatoryUrl,
                          interval: '2m',
                          sampling: 3,
                          timeout: '3s',
                      },
                      subjectSelector: [group.selectorPrefix],
                  },
              }
            : {}),
        dns: {
            queryStrategy: 'UseIP',
            servers: ['https://8.8.8.8/dns-query', 'https://8.8.4.4/dns-query'],
        },
        inbounds: buildInbounds(),
        outbounds: [...proxyOutbounds, buildDirectOutbound(), buildBlockOutbound()],
        remarks: group.groupName,
        routing: {
            ...(hasBalancer
                ? {
                      balancers: [
                          {
                              fallbackTag: proxyTags[0],
                              selector: [group.selectorPrefix],
                              strategy: {
                                  settings: {
                                      baselines: ['200ms', '500ms'],
                                      expected: 7,
                                      maxRTT: '2500ms',
                                      tolerance: 0,
                                  },
                                  type: 'leastLoad' as const,
                              },
                              tag: group.balancerTag,
                          },
                      ],
                  }
                : {}),
            domainMatcher: 'hybrid',
            domainStrategy: 'IPIfNonMatch',
            rules: [
                {
                    outboundTag: 'direct',
                    protocol: ['bittorrent'],
                    type: 'field',
                },
                {
                    domain: RUSSIAN_DIRECT_DOMAINS,
                    outboundTag: 'direct',
                    type: 'field',
                },
                hasBalancer
                    ? {
                          balancerTag: group.balancerTag,
                          network: 'tcp',
                          type: 'field',
                      }
                    : {
                          network: 'tcp',
                          outboundTag: proxyTags[0],
                          type: 'field',
                      },
            ],
        },
    };
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

    if (network !== 'raw' && network !== 'tcp') {
        throw new Error(`Unsupported VLESS transport "${network}" for outbound ${tag} (${link.address})`);
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
                            ...(link.query.flow ? { flow: link.query.flow } : {}),
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
            throw new Error(`Missing required REALITY field "${field}" for outbound ${tag} (${link.address})`);
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
