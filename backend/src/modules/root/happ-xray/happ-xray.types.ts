export interface HappParsedVlessLink {
    address: string;
    id: string;
    port: number;
    query: Record<string, string>;
    remark: string;
    raw: string;
}

export interface HappGroupedCandidate {
    groupName: string;
    link: HappParsedVlessLink;
    outboundTag: string;
    tier: HappTier;
}

export interface HappGroup {
    balancerTag: string;
    candidates: HappGroupedCandidate[];
    groupName: string;
    selectorPrefix: string;
    tier: HappTier;
}

export interface HappXrayGeneratorOptions {
    observatoryUrl: string;
    whitelistSuffix: string;
}

export type HappTier = 'MAIN' | 'WL';

export interface HappXrayConfig {
    observatory: {
        enableConcurrency: boolean;
        probeInterval: string;
        probeUrl: string;
        subjectSelector: string[];
    };
    outbounds: HappXrayOutbound[];
    routing: {
        balancers: Array<{
            selector: string[];
            strategy: { type: 'leastPing' };
            tag: string;
        }>;
        domainStrategy: 'AsIs';
        rules: [];
    };
}

export interface HappXrayOutbound {
    protocol: 'vless';
    settings: {
        address: string;
        encryption: string;
        flow?: string;
        id: string;
        port: number;
    };
    streamSettings: {
        network: string;
        realitySettings?: {
            fingerprint?: string;
            password?: string;
            serverName?: string;
            shortId?: string;
            spiderX?: string;
        };
        security: string;
    };
    tag: string;
}
