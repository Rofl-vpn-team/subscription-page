import {
    HappGroup,
    HappParsedVlessLink,
    HappXrayConfig,
    HappXrayGeneratorOptions,
    HappXrayOutbound,
    HappXrayProxyOutbound,
} from './happ-xray.types';
import { groupHappLinks } from './happ-xray-grouping';

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
                              strategy: { type: 'leastPing' as const },
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
                hasBalancer
                    ? {
                          balancerTag: group.balancerTag,
                          network: 'tcp,udp',
                          type: 'field',
                      }
                    : {
                          network: 'tcp,udp',
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
