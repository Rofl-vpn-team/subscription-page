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

export interface HappXrayBurstObservatoryPingConfig {
    connectivity: string;
    destination: string;
    interval: string;
    sampling: number;
    timeout: string;
}

export interface HappXrayGeneratorOptions {
    burstObservatoryPingConfig: HappXrayBurstObservatoryPingConfig;
    hysteriaSalamanderPassword: string;
    whitelistSuffix: string;
}

export type HappTier = 'MAIN' | 'WL';

export type HappProxyProtocol = 'vless' | 'hysteria';

interface HappResolvedProxyOutboundFields {
    mux?: Record<string, unknown>;
    settings: Record<string, unknown>;
    streamSettings: {
        network: string;
    } & Record<string, unknown>;
    tag: string;
}

export type HappResolvedProxyOutbound = ({ protocol: 'vless' } | { protocol: 'hysteria' }) &
    HappResolvedProxyOutboundFields;

export interface HappResolvedCandidate {
    identity: string;
    outbound: HappResolvedProxyOutbound;
    protocol: HappProxyProtocol;
}

export interface HappResolvedGroup {
    candidates: HappResolvedCandidate[];
    groupName: string;
    tier: HappTier;
}

export interface HappXrayConfig {
    burstObservatory?: {
        pingConfig: HappXrayBurstObservatoryPingConfig;
        subjectSelector: string[];
    };
    dns: {
        disableFallbackIfMatch: boolean;
        enableParallelQuery: boolean;
        queryStrategy: 'UseIPv4';
        servers: Array<
            | string
            | {
                  address: string;
                  domains: string[];
              }
        >;
    };
    inbounds: Array<{
        listen: '127.0.0.1';
        port: number;
        protocol: 'socks' | 'http';
        settings: Record<string, unknown>;
        sniffing?: {
            destOverride: string[];
            enabled: boolean;
            routeOnly: boolean;
        };
        tag: string;
    }>;
    outbounds: HappXrayOutbound[];
    remarks: string;
    routing: {
        balancers?: Array<{
            fallbackTag: string;
            selector: string[];
            strategy: {
                settings: {
                    baselines: string[];
                    expected: number;
                    maxRTT: string;
                    tolerance: number;
                };
                type: 'leastLoad';
            };
            tag: string;
        }>;
        domainMatcher: 'hybrid';
        domainStrategy: 'IPIfNonMatch';
        rules: Array<{
            balancerTag?: string;
            domain?: string[];
            ip?: string[];
            inboundTag?: string[];
            network?: string;
            outboundTag?: string;
            protocol?: string[];
            type: 'field';
        }>;
    };
}

export type HappXrayOutbound =
    | HappResolvedProxyOutbound
    | {
          mux: {
              concurrency: number;
              enabled: boolean;
          };
          protocol: 'vless';
          settings: {
              vnext: Array<{
                  address: string;
                  port: number;
                  users: Array<{
                      encryption: string;
                      flow?: string;
                      id: string;
                      level: number;
                  }>;
              }>;
          };
          streamSettings: {
              network: string;
              realitySettings?: {
                  allowInsecure: boolean;
                  fingerprint?: string;
                  publicKey?: string;
                  serverName?: string;
                  shortId?: string;
                  show: boolean;
                  spiderX?: string;
              };
              security: string;
              tcpSettings?: {
                  header: {
                      type: 'none';
                  };
              };
          };
          tag: string;
      }
    | {
          protocol: 'freedom';
          settings: {
              domainStrategy: 'UseIP';
          };
          tag: 'direct';
      }
    | {
          protocol: 'blackhole';
          settings: {
              response: {
                  type: 'http';
              };
          };
          tag: 'block';
      }
    | {
          protocol: 'loopback';
          settings: {
              inboundTag: string;
          };
          tag: string;
      };

export type HappXrayProxyOutbound = Extract<HappXrayOutbound, { protocol: 'vless' }>;
