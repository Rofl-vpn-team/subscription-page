import {
    HappGroup,
    HappParsedVlessLink,
    HappXrayConfig,
    HappXrayGeneratorOptions,
    HappXrayOutbound,
} from './happ-xray.types';
import { groupHappLinks } from './happ-xray-grouping';

export function buildGroupedHappXrayConfig(
    links: HappParsedVlessLink[],
    options: HappXrayGeneratorOptions,
): HappXrayConfig {
    const groups = groupHappLinks(links, { whitelistSuffix: options.whitelistSuffix });
    const outbounds = groups.flatMap((group) =>
        group.candidates.map((candidate) => buildOutbound(candidate.outboundTag, candidate.link)),
    );

    return {
        observatory: {
            enableConcurrency: true,
            probeInterval: '5m',
            probeUrl: options.observatoryUrl,
            subjectSelector: ['out_'],
        },
        outbounds,
        routing: {
            balancers: groups.map(buildBalancer),
            domainStrategy: 'AsIs',
            // Compatibility surface for Happ import testing: plain Xray core only uses balancers
            // when routing rules point at them. Catch-all rules would make only the first group
            // reachable because routing is first-match, so keep this flag-gated until Happ proves
            // it renders routing.balancers as selectable UI groups.
            rules: [],
        },
    };
}

function buildBalancer(group: HappGroup) {
    return {
        selector: [group.selectorPrefix],
        strategy: { type: 'leastPing' as const },
        tag: group.balancerTag,
    };
}

function buildOutbound(tag: string, link: HappParsedVlessLink): HappXrayOutbound {
    const realitySettings = buildRealitySettings(tag, link);
    const network = link.query.type ?? 'raw';

    if (network !== 'raw') {
        throw new Error(`Unsupported VLESS transport "${network}" for outbound ${tag} (${link.address})`);
    }

    return {
        protocol: 'vless',
        settings: {
            address: link.address,
            encryption: link.query.encryption ?? 'none',
            ...(link.query.flow ? { flow: link.query.flow } : {}),
            id: link.id,
            port: link.port,
        },
        streamSettings: {
            network,
            ...(realitySettings ? { realitySettings } : {}),
            security: link.query.security ?? 'none',
        },
        tag,
    };
}

function buildRealitySettings(
    tag: string,
    link: HappParsedVlessLink,
): HappXrayOutbound['streamSettings']['realitySettings'] {
    if (link.query.security !== 'reality') {
        return undefined;
    }

    for (const field of ['fp', 'pbk', 'sni'] as const) {
        if (!link.query[field]) {
            throw new Error(`Missing required REALITY field "${field}" for outbound ${tag} (${link.address})`);
        }
    }

    return {
        fingerprint: link.query.fp,
        password: link.query.pbk,
        serverName: link.query.sni,
        ...(link.query.sid ? { shortId: link.query.sid } : {}),
        ...(link.query.spx ? { spiderX: link.query.spx } : {}),
    };
}
