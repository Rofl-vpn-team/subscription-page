import { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { dump, load } from 'js-yaml';
import { nanoid } from 'nanoid';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { TypedConfigService } from '@common/config/app-config';
import { AxiosService } from '@common/axios/axios.service';
import { IGNORED_HEADERS } from '@common/constants';
import { sanitizeUsername } from '@common/utils';

import type {
    HappHysteriaRolloutConfig,
    HappResolvedGroup,
    HappXrayBurstObservatoryPingConfig,
} from './happ-xray';

import {
    buildGroupedHappXrayConfigs,
    buildResolvedHappXrayConfigs,
    isHappHysteriaSelected,
    parseHappVlessLine,
    parseHappXrayCarrier,
} from './happ-xray';
import { SubpageConfigService } from './subpage-config.service';

const MIHOMO_CLIENT_TYPE = 'mihomo' as const satisfies TRequestTemplateTypeKeys;
const XRAY_JSON_CLIENT_TYPE = 'v2ray-json' as const satisfies TRequestTemplateTypeKeys;

interface RemnawaveDescriptionMetadata {
    role: string;
    mainUuid?: string;
    mainShortUuid?: string;
    fallbackUuid?: string;
    fallbackShortUuid?: string;
}

interface FallbackLookupResult {
    isMainFound: boolean;
    fallbackShortUuid: string | null;
}

type MihomoConfig = Record<string, unknown>;

@Injectable()
export class RootService {
    private readonly logger = new Logger(RootService.name);

    private readonly happXrayGroupedConfigEnabled: boolean;
    private readonly happXrayBurstObservatoryPingConfig: HappXrayBurstObservatoryPingConfig;
    private readonly happXrayHysteriaRolloutConfig: HappHysteriaRolloutConfig;
    private readonly happXrayWhitelistSuffix: string;
    private readonly isMarzbanLegacyLinkEnabled: boolean;
    private readonly marzbanSecretKeys: string[];
    private readonly mlDropRevokedSubscriptions: boolean;
    constructor(
        private readonly configService: TypedConfigService,
        private readonly jwtService: JwtService,
        private readonly axiosService: AxiosService,
        private readonly subpageConfigService: SubpageConfigService,
    ) {
        this.isMarzbanLegacyLinkEnabled = this.configService.getOrThrow(
            'MARZBAN_LEGACY_LINK_ENABLED',
        );
        this.mlDropRevokedSubscriptions = this.configService.getOrThrow(
            'MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS',
        );
        this.happXrayGroupedConfigEnabled = this.configService.getOrThrow(
            'HAPP_XRAY_GROUPED_CONFIG_ENABLED',
        );
        this.happXrayBurstObservatoryPingConfig = {
            connectivity: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY'),
            destination: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_DESTINATION'),
            interval: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_INTERVAL'),
            sampling: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_SAMPLING'),
            timeout: this.configService.getOrThrow('HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT'),
        };
        this.happXrayHysteriaRolloutConfig = {
            allowlist: this.configService
                .getOrThrow('HAPP_XRAY_HYSTERIA_ALLOWLIST')
                .split(',')
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
            mode: this.configService.getOrThrow('HAPP_XRAY_HYSTERIA_ROLLOUT_MODE'),
            percentage: this.configService.getOrThrow('HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT'),
        };
        this.happXrayWhitelistSuffix = this.configService.getOrThrow('HAPP_XRAY_WHITELIST_SUFFIX');

        const marzbanSecretKeys = this.configService.get('MARZBAN_LEGACY_SECRET_KEY');

        if (marzbanSecretKeys && marzbanSecretKeys.length > 0) {
            this.marzbanSecretKeys = marzbanSecretKeys.split(',').map((key) => key.trim());
        } else {
            this.marzbanSecretKeys = [];
        }
    }

    public async serveAggregatedMihomoConfig(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        try {
            const mainConfigResponse = await this.axiosService.getSubscription(
                clientIp,
                mainShortUuid,
                req.headers,
                true,
                MIHOMO_CLIENT_TYPE,
            );

            if (!mainConfigResponse) {
                res.status(404).send('Not Found');
                return;
            }

            const fallbackLookupResult = await this.getFallbackLookupResult(
                clientIp,
                mainShortUuid,
            );

            if (!fallbackLookupResult.isMainFound) {
                this.logger.warn(
                    `Main Mihomo config exists, but Remnawave user lookup failed for ${mainShortUuid}; aggregating with fallback provider stubbed.`,
                );
            }

            if (!fallbackLookupResult.fallbackShortUuid) {
                this.logger.debug(
                    `No fallbackShortUuid for ${mainShortUuid}; fallback-provider will be injected anyway and serve 404 (mihomo treats it as empty).`,
                );
            }

            const publicBaseUrl = this.getPublicBaseUrl(req);
            const encodedMainShortUuid = encodeURIComponent(mainShortUuid);
            const hwidHeader = this.getHwidHeader(req);
            const mihomoConfig = this.buildAggregatedMihomoConfig(
                mainConfigResponse.response,
                publicBaseUrl,
                encodedMainShortUuid,
                hwidHeader,
            );

            res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
            res.setHeader(
                'Cache-Control',
                'no-cache, no-store, must-revalidate, private, max-age=0',
            );
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.status(200).send(mihomoConfig);
        } catch (error) {
            this.logger.error('Error in serveAggregatedMihomoConfig', error);

            res.socket?.destroy();
            return;
        }
    }

    public async serveMainMihomoProvider(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        return await this.serveMihomoProvider(clientIp, req, res, mainShortUuid);
    }

    public async serveFallbackMihomoProvider(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        try {
            const fallbackShortUuid = await this.getFallbackShortUuid(clientIp, mainShortUuid);

            if (!fallbackShortUuid) {
                res.status(404).send('Not Found');
                return;
            }

            return await this.serveMihomoProvider(clientIp, req, res, fallbackShortUuid);
        } catch (error) {
            this.logger.error('Error in serveFallbackMihomoProvider', error);

            res.socket?.destroy();
            return;
        }
    }

    public async serveAggregatedHappConfig(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        if (!isHappHysteriaSelected(mainShortUuid, this.happXrayHysteriaRolloutConfig)) {
            return await this.serveLegacyAggregatedHappConfig(clientIp, req, res, mainShortUuid);
        }

        try {
            return await this.serveResolvedAggregatedHappConfig(clientIp, req, res, mainShortUuid);
        } catch (error) {
            this.logger.warn(
                `event=happ_hysteria_generation_fallback errorClass=${this.getSafeErrorClass(error)}`,
            );

            return await this.serveLegacyAggregatedHappConfig(clientIp, req, res, mainShortUuid);
        }
    }

    private async serveResolvedAggregatedHappConfig(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        const mainResponse = await this.axiosService.getSubscription(
            clientIp,
            mainShortUuid,
            req.headers,
            true,
            XRAY_JSON_CLIENT_TYPE,
        );

        if (!mainResponse) {
            throw new Error('HAPP XRAY_JSON main carrier is unavailable.');
        }

        const mainGroups = parseHappXrayCarrier(mainResponse.response, {
            tier: 'MAIN',
            whitelistSuffix: this.happXrayWhitelistSuffix,
        });
        const fallbackLookupResult = await this.getFallbackLookupResult(clientIp, mainShortUuid);
        let fallbackGroups: HappResolvedGroup[] = [];

        if (fallbackLookupResult.fallbackShortUuid) {
            const fallbackResponse = await this.axiosService.getSubscription(
                clientIp,
                fallbackLookupResult.fallbackShortUuid,
                req.headers,
                true,
                XRAY_JSON_CLIENT_TYPE,
            );

            if (fallbackResponse) {
                fallbackGroups = parseHappXrayCarrier(fallbackResponse.response, {
                    tier: 'WL',
                    whitelistSuffix: this.happXrayWhitelistSuffix,
                });
            }
        }

        const configs = buildResolvedHappXrayConfigs([...mainGroups, ...fallbackGroups], {
            burstObservatoryPingConfig: this.happXrayBurstObservatoryPingConfig,
            whitelistSuffix: this.happXrayWhitelistSuffix,
        });

        this.setProxyHeaders(res, mainResponse.headers);
        this.applyNoCacheHeaders(res);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(200).send(JSON.stringify(configs));
    }

    private async serveLegacyAggregatedHappConfig(
        clientIp: string,
        req: Request,
        res: Response,
        mainShortUuid: string,
    ): Promise<void> {
        try {
            const mainResp = await this.axiosService.getSubscription(
                clientIp,
                mainShortUuid,
                req.headers,
                false,
                undefined,
            );

            if (!mainResp) {
                res.status(404).send('Not Found');
                return;
            }

            const fallbackLookupResult = await this.getFallbackLookupResult(
                clientIp,
                mainShortUuid,
            );

            if (!fallbackLookupResult.isMainFound) {
                this.logger.warn(
                    `Main Happ config exists, but Remnawave user lookup failed for ${mainShortUuid}; returning main config only.`,
                );
                this.sendHappPayload(res, mainResp.headers, mainResp.response);
                return;
            }

            if (!fallbackLookupResult.fallbackShortUuid) {
                this.logger.debug(
                    `No fallbackShortUuid for ${mainShortUuid}; returning main Happ config without merge.`,
                );
                this.sendHappPayload(res, mainResp.headers, mainResp.response);
                return;
            }

            const fallbackResp = await this.axiosService.getSubscription(
                clientIp,
                fallbackLookupResult.fallbackShortUuid,
                req.headers,
                false,
                undefined,
            );

            if (!fallbackResp) {
                this.logger.warn(
                    `Fallback Happ subscription fetch failed for ${fallbackLookupResult.fallbackShortUuid}; returning main config only.`,
                );
                this.sendHappPayload(res, mainResp.headers, mainResp.response);
                return;
            }

            const merged = this.mergeHappSubscriptionPayloads(
                mainResp.response,
                fallbackResp.response,
            );
            this.sendHappPayload(res, mainResp.headers, merged);
        } catch (error) {
            this.logger.error('Error in serveAggregatedHappConfig', error);
            res.socket?.destroy();
            return;
        }
    }

    private mergeHappSubscriptionPayloads(mainPayload: unknown, fallbackPayload: unknown): string {
        const mainLines = this.decodeHappSubscriptionPayloadLines(mainPayload);
        const fallbackLines = this.decodeHappSubscriptionPayloadLines(fallbackPayload);

        const merged = [...mainLines, ...fallbackLines].join('\n');
        return Buffer.from(merged, 'utf-8').toString('base64');
    }

    private sendHappPayload(
        res: Response,
        headers: RawAxiosResponseHeaders | AxiosResponseHeaders,
        payload: unknown,
    ): void {
        const groupedHappXrayPayload = this.tryBuildGroupedHappXrayPayload(payload);

        this.setProxyHeaders(res, headers);
        this.applyNoCacheHeaders(res);
        if (groupedHappXrayPayload) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.status(200).send(groupedHappXrayPayload ?? payload);
    }

    private tryBuildGroupedHappXrayPayload(payload: unknown): string | null {
        if (!this.happXrayGroupedConfigEnabled) {
            return null;
        }

        let lineCount = 0;

        try {
            const lines = this.decodeHappSubscriptionPayloadLines(payload);
            lineCount = lines.length;

            const configs = buildGroupedHappXrayConfigs(lines.map(parseHappVlessLine), {
                burstObservatoryPingConfig: this.happXrayBurstObservatoryPingConfig,
                whitelistSuffix: this.happXrayWhitelistSuffix,
            });

            return JSON.stringify(configs);
        } catch (error) {
            this.logger.warn(
                `Grouped Happ Xray config build failed; returning base64 Happ payload. lineCount=${lineCount}; error=${this.getSafeErrorMessage(error)}`,
            );

            return null;
        }
    }

    private decodeHappSubscriptionPayloadLines(payload: unknown): string[] {
        if (typeof payload !== 'string') {
            return [];
        }

        return Buffer.from(payload, 'base64')
            .toString('utf-8')
            .split('\n')
            .filter((line) => line.trim().length > 0);
    }

    private getSafeErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }

    private getSafeErrorClass(error: unknown): string {
        if (error instanceof Error) {
            return error.constructor.name;
        }

        return typeof error;
    }

    public async serveSubscriptionPage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<void> {
        try {
            const userAgent = req.headers['user-agent'];

            let shortUuidLocal = shortUuid;

            if (this.isGenericPath(req.path)) {
                res.socket?.destroy();
                return;
            }

            if (this.isMarzbanLegacyLinkEnabled) {
                const username = await this.tryDecodeMarzbanLink(shortUuid);

                if (username) {
                    const sanitizedUsername = sanitizeUsername(username.username);

                    this.logger.log(
                        `Decoded Marzban username: ${username.username}, sanitized username: ${sanitizedUsername}`,
                    );

                    const userInfo = await this.axiosService.getUserByUsername(
                        clientIp,
                        sanitizedUsername,
                    );
                    if (!userInfo.isOk || !userInfo.response) {
                        this.logger.error(
                            `Decoded Marzban username is not found in Remnawave, decoded username: ${sanitizedUsername}`,
                        );

                        res.socket?.destroy();
                        return;
                    } else if (
                        this.mlDropRevokedSubscriptions &&
                        userInfo.response.response.subRevokedAt !== null
                    ) {
                        res.socket?.destroy();
                        return;
                    }

                    shortUuidLocal = userInfo.response.response.shortUuid;
                }
            }

            if (userAgent && this.isBrowser(userAgent)) {
                return this.returnWebpage(clientIp, req, res, shortUuidLocal);
            }

            const subscriptionDataResponse = await this.axiosService.getSubscription(
                clientIp,
                shortUuidLocal,
                req.headers,
                !!clientType,
                clientType,
            );

            if (!subscriptionDataResponse) {
                res.socket?.destroy();
                return;
            }

            this.setProxyHeaders(res, subscriptionDataResponse.headers);

            res.status(200).send(subscriptionDataResponse.response);
            return;
        } catch (error) {
            this.logger.error('Error in serveSubscriptionPage', error);

            res.socket?.destroy();
            return;
        }
    }

    private async serveMihomoProvider(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscription(
                clientIp,
                shortUuid,
                req.headers,
                true,
                MIHOMO_CLIENT_TYPE,
            );

            this.logger.log(`Fallback short UUID: ${shortUuid}`);
            if (!subscriptionDataResponse) {
                res.status(404).send('Not Found');
                return;
            }

            this.setProxyHeaders(res, subscriptionDataResponse.headers);
            res.status(200).send(subscriptionDataResponse.response);
        } catch (error) {
            this.logger.error('Error in serveMihomoProvider', error);

            res.socket?.destroy();
            return;
        }
    }

    private async getFallbackShortUuid(
        clientIp: string,
        mainShortUuid: string,
    ): Promise<string | null> {
        const fallbackLookupResult = await this.getFallbackLookupResult(clientIp, mainShortUuid);

        return fallbackLookupResult.fallbackShortUuid;
    }

    private async getFallbackLookupResult(
        clientIp: string,
        mainShortUuid: string,
    ): Promise<FallbackLookupResult> {
        const mainUserResponse = await this.axiosService.getUserByShortUuid(
            clientIp,
            mainShortUuid,
        );

        if (!mainUserResponse.isOk || !mainUserResponse.response) {
            this.logger.warn('Main Remnawave user lookup failed.');
            return {
                isMainFound: false,
                fallbackShortUuid: null,
            };
        }

        const fallbackShortUuid = this.parseFallbackShortUuid(
            mainUserResponse.response.description,
        );

        if (!fallbackShortUuid) {
            return {
                isMainFound: true,
                fallbackShortUuid: null,
            };
        }

        const fallbackUserResponse = await this.axiosService.getUserByShortUuid(
            clientIp,
            fallbackShortUuid,
        );

        if (!fallbackUserResponse.isOk || !fallbackUserResponse.response) {
            this.logger.warn('Fallback Remnawave user lookup failed.');
            return {
                isMainFound: true,
                fallbackShortUuid: null,
            };
        }

        return {
            isMainFound: true,
            fallbackShortUuid,
        };
    }

    private parseFallbackShortUuid(description: string | null): string | null {
        if (!description) {
            this.logger.debug('Main Remnawave user has empty description.');
            return null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(description);
        } catch {
            this.logger.warn('Main Remnawave user has invalid description JSON.');
            return null;
        }

        if (!this.isMainMetadataWithFallback(parsed)) {
            this.logger.debug('Main Remnawave user description has no fallbackShortUuid.');
            return null;
        }

        return parsed.fallbackShortUuid;
    }

    private isMainMetadataWithFallback(
        value: unknown,
    ): value is { fallbackShortUuid: string } & RemnawaveDescriptionMetadata {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const metadata = value as Partial<RemnawaveDescriptionMetadata>;

        return (
            metadata.role === 'main' &&
            typeof metadata.fallbackShortUuid === 'string' &&
            metadata.fallbackShortUuid.length > 0
        );
    }

    private buildAggregatedMihomoConfig(
        mainConfigResponse: unknown,
        publicBaseUrl: string,
        encodedMainShortUuid: string,
        hwidHeader: string[] | undefined,
    ): string {
        const mihomoConfig = this.parseMihomoConfig(mainConfigResponse);
        const mainProviderUrl = `${publicBaseUrl}/provider/main/${encodedMainShortUuid}`;
        const fallbackProviderUrl = `${publicBaseUrl}/provider/fallback/${encodedMainShortUuid}`;
        const healthCheckUrl = 'https://www.gstatic.com/generate_204';

        // Drop the inline proxies list from the aggregated config: clients
        // pull proxy data from the two HTTP providers below. Keeping inline
        // entries here only surfaces internal MAIN-*/WL-* host names (and
        // Remnawave-side `^~2~^` collisions) in the client UI without adding
        // any functional value. The /provider/* endpoints still serve full
        // template renderings, so Mihomo's HTTP provider mechanism keeps
        // refreshing proxies every 3600s.
        delete mihomoConfig['proxies'];

        // Inject proxy-providers. Country selectors, VPN top-level group and
        // any group-level filters are defined in the Remnawave mihomo template
        // (mihomo_subscription.yml.j2). Server only adds the two HTTP
        // providers so groups in the template can resolve `use: [main-provider,
        // fallback-provider]` references.
        mihomoConfig['proxy-providers'] = {
            ...(this.isPlainObject(mihomoConfig['proxy-providers'])
                ? mihomoConfig['proxy-providers']
                : {}),
            'main-provider': {
                type: 'http',
                url: mainProviderUrl,
                interval: 3_600,
                ...(hwidHeader ? { header: { 'x-hwid': hwidHeader } } : {}),
                'health-check': {
                    enable: true,
                    url: healthCheckUrl,
                    interval: 300,
                    timeout: 5_000,
                    lazy: true,
                },
            },
            'fallback-provider': {
                type: 'http',
                url: fallbackProviderUrl,
                interval: 3_600,
                ...(hwidHeader ? { header: { 'x-hwid': hwidHeader } } : {}),
                'health-check': {
                    enable: true,
                    url: healthCheckUrl,
                    interval: 300,
                    timeout: 5_000,
                    lazy: true,
                },
            },
        };

        return dump(mihomoConfig, {
            lineWidth: -1,
            noRefs: true,
        });
    }

    private parseMihomoConfig(response: unknown): MihomoConfig {
        const parsedConfig = typeof response === 'string' ? load(response) : response;

        if (!this.isPlainObject(parsedConfig)) {
            throw new Error('Main Mihomo config is not a YAML object.');
        }

        return parsedConfig;
    }

    private isPlainObject(value: unknown): value is MihomoConfig {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private getHwidHeader(req: Request): string[] | undefined {
        const header = req.headers['x-hwid'] ?? req.headers.hwid;

        if (!header) {
            return undefined;
        }

        if (Array.isArray(header)) {
            return header;
        }

        return [header];
    }

    private getPublicBaseUrl(req: Request): string {
        const configuredBaseUrl = this.configService.get('SUBSCRIPTION_PUBLIC_BASE_URL');

        if (configuredBaseUrl) {
            return configuredBaseUrl.replace(/\/+$/, '');
        }

        const forwardedProtoHeader = req.headers['x-forwarded-proto'];
        const forwardedProto = Array.isArray(forwardedProtoHeader)
            ? forwardedProtoHeader[0]
            : forwardedProtoHeader;
        const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol;

        return `${protocol}://${req.get('host')}`.replace(/\/+$/, '');
    }

    private setProxyHeaders(
        res: Response,
        headers: RawAxiosResponseHeaders | AxiosResponseHeaders,
    ): void {
        Object.entries(headers)
            .filter(([key]) => !IGNORED_HEADERS.has(key.toLowerCase()))
            .forEach(([key, value]) => {
                res.setHeader(key, value);
            });
    }

    private applyNoCacheHeaders(res: Response): void {
        // Force no client-side caching for dynamic subscription payloads.
        // Cache-Control + Pragma + Expires for well-behaved clients.
        // ETag forced unique per-response to defeat clients that ignore
        // Cache-Control and validate via If-None-Match (observed in Happ
        // on macOS Catalyst: it kept stale local body on every refresh
        // because the upstream ETag matched, triggering 304 Not Modified).
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('ETag', `W/"${Date.now().toString(36)}-${nanoid(10)}"`);
    }

    private generateJwtForCookie(uuid: string | null): string {
        return this.jwtService.sign(
            {
                sessionId: nanoid(32),
                su: this.subpageConfigService.getEncryptedSubpageConfigUuid(uuid),
            },
            {
                expiresIn: '33m',
            },
        );
    }

    private isBrowser(userAgent: string): boolean {
        const browserKeywords = [
            'Mozilla',
            'Chrome',
            'Safari',
            'Firefox',
            'Opera',
            'Edge',
            'TelegramBot',
            'WhatsApp',
        ];

        return browserKeywords.some((keyword) => userAgent.includes(keyword));
    }

    private isGenericPath(path: string): boolean {
        const genericPaths = [
            'favicon.ico',
            'robots.txt',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.webp',
            '.ico',
        ];

        return genericPaths.some((genericPath) => path.includes(genericPath));
    }

    private async returnWebpage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscriptionInfo(
                clientIp,
                shortUuid,
            );

            if (!subscriptionDataResponse.isOk || !subscriptionDataResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfigResponse = await this.axiosService.getSubpageConfig(
                shortUuid,
                req.headers,
            );

            if (!subpageConfigResponse.isOk || !subpageConfigResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfig = subpageConfigResponse.response;

            if (subpageConfig.webpageAllowed === false) {
                this.logger.log(`Webpage access is not allowed by Remnawave's SRR.`);
                res.socket?.destroy();
                return;
            }

            const baseSettings = this.subpageConfigService.getBaseSettings(
                subpageConfig.subpageConfigUuid,
            );

            const subscriptionData = subscriptionDataResponse.response;

            if (!baseSettings.showConnectionKeys) {
                subscriptionData.response.links = [];
                subscriptionData.response.ssConfLinks = {};
            }

            res.cookie('session', this.generateJwtForCookie(subpageConfig.subpageConfigUuid), {
                httpOnly: true,
                secure: true,
                maxAge: 1_800_000, // 30 minutes
            });

            res.render('index', {
                metaTitle: baseSettings.metaTitle,
                metaDescription: baseSettings.metaDescription,
                panelData: Buffer.from(JSON.stringify(subscriptionData)).toString('base64'),
            });
        } catch (error) {
            this.logger.error(`Error in returnWebpage: ${error}`);

            res.socket?.destroy();
            return;
        }
    }

    private async tryDecodeMarzbanLink(shortUuid: string): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (!this.marzbanSecretKeys.length) return null;

        const token = shortUuid;
        this.logger.debug(`Verifying token: ${token}`);

        if (!token || token.length < 10) {
            this.logger.debug(`Token too short: ${token}`);
            return null;
        }

        for (const key of this.marzbanSecretKeys) {
            const result = await this.decodeMarzbanLink(shortUuid, key);
            if (result) return result;

            this.logger.debug(`Decoding Marzban link failed with key: ${key}`);
        }

        this.logger.debug(`Decoding Marzban link failed with all keys`);

        return null;
    }

    private async decodeMarzbanLink(
        token: string,
        marzbanSecretKey: string,
    ): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (token.split('.').length === 3) {
            try {
                const payload = await this.jwtService.verifyAsync(token, {
                    secret: marzbanSecretKey,
                    algorithms: ['HS256'],
                });

                if (payload.access !== 'subscription') {
                    throw new Error('JWT access field is not subscription');
                }

                const jwtCreatedAt = new Date(payload.iat * 1000);

                if (!this.checkSubscriptionValidity(jwtCreatedAt, payload.sub)) {
                    return null;
                }

                this.logger.debug(`JWT verified successfully, ${JSON.stringify(payload)}`);

                return {
                    username: payload.sub,
                    createdAt: jwtCreatedAt,
                };
            } catch (err) {
                this.logger.debug(`JWT verification failed: ${err}`);
            }
        }

        const uToken = token.slice(0, token.length - 10);
        const uSignature = token.slice(token.length - 10);

        this.logger.debug(`Token parts: base: ${uToken}, signature: ${uSignature}`);

        let decoded: string;
        try {
            decoded = Buffer.from(uToken, 'base64url').toString();
        } catch (err) {
            this.logger.debug(`Base64 decode error: ${err}`);
            return null;
        }

        const hash = createHash('sha256');
        hash.update(uToken + marzbanSecretKey);
        const digest = hash.digest();

        const expectedSignature = Buffer.from(digest).toString('base64url').slice(0, 10);

        this.logger.debug(`Expected signature: ${expectedSignature}, actual: ${uSignature}`);

        if (uSignature !== expectedSignature) {
            this.logger.debug('Signature mismatch');
            return null;
        }

        const parts = decoded.split(',');
        if (parts.length < 2) {
            this.logger.debug(`Invalid token format: ${decoded}`);
            return null;
        }

        const username = parts[0];
        const createdAtInt = parseInt(parts[1], 10);

        if (isNaN(createdAtInt)) {
            this.logger.debug(`Invalid created_at timestamp: ${parts[1]}`);
            return null;
        }

        const createdAt = new Date(createdAtInt * 1000);

        if (!this.checkSubscriptionValidity(createdAt, username)) {
            return null;
        }

        this.logger.debug(`Token decoded. Username: ${username}, createdAt: ${createdAt}`);

        return {
            username,
            createdAt,
        };
    }

    private checkSubscriptionValidity(createdAt: Date, username: string): boolean {
        const validFrom = this.configService.get('MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM');

        if (!validFrom) {
            return true;
        }

        const validFromDate = new Date(validFrom);
        if (createdAt < validFromDate) {
            this.logger.debug(
                `createdAt JWT: ${createdAt.toISOString()} is before validFrom: ${validFromDate.toISOString()}`,
            );

            this.logger.warn(
                `${JSON.stringify({ username, createdAt })} – subscription createdAt is before validFrom`,
            );

            return false;
        }

        return true;
    }
}
