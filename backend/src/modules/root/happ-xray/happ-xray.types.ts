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
    burstObservatory?: {
        pingConfig: {
            connectivity: string;
            destination: string;
            interval: string;
            sampling: number;
            timeout: string;
        };
        subjectSelector: string[];
    };
    dns: {
        queryStrategy: 'UseIP';
        servers: string[];
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
            network?: string;
            outboundTag?: string;
            protocol?: string[];
            type: 'field';
        }>;
    };
}

export type HappXrayOutbound =
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
      };

export type HappXrayProxyOutbound = Extract<HappXrayOutbound, { protocol: 'vless' }>;
