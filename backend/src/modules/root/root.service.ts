import { RawAxiosResponseHeaders } from 'axios';
import { AxiosResponseHeaders } from 'axios';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { dump, load } from 'js-yaml';
import { nanoid } from 'nanoid';

import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { AxiosService } from '@common/axios/axios.service';
import { IGNORED_HEADERS } from '@common/constants';
import { sanitizeUsername } from '@common/utils';

import { SubpageConfigService } from './subpage-config.service';

const MIHOMO_CLIENT_TYPE = 'mihomo' as const satisfies TRequestTemplateTypeKeys;

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

interface MihomoProxyGroup extends MihomoConfig {
    name: string;
    type: string;
}

@Injectable()
export class RootService {
    private readonly logger = new Logger(RootService.name);

    private readonly isMarzbanLegacyLinkEnabled: boolean;
    private readonly marzbanSecretKeys: string[];
    private readonly mlDropRevokedSubscriptions: boolean;
    private readonly mihomoVpnGroupName: string;
    constructor(
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        private readonly axiosService: AxiosService,
        private readonly subpageConfigService: SubpageConfigService,
    ) {
        this.isMarzbanLegacyLinkEnabled = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_LINK_ENABLED',
        );
        this.mlDropRevokedSubscriptions = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS',
        );
        this.mihomoVpnGroupName =
            this.configService.get<string | undefined>('MIHOMO_VPN_GROUP_NAME') || '🛡️ VPN';

        const marzbanSecretKeys = this.configService.get<string>('MARZBAN_LEGACY_SECRET_KEY');

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
                    `Main Mihomo config exists, but Remnawave user lookup failed for ${mainShortUuid}; returning original main config.`,
                );
            }

            if (!fallbackLookupResult.fallbackShortUuid) {
                this.setProxyHeaders(res, mainConfigResponse.headers);
                res.status(200).send(mainConfigResponse.response);
                return;
            }

            const publicBaseUrl = this.getPublicBaseUrl(req);
            const encodedMainShortUuid = encodeURIComponent(mainShortUuid);
            const mihomoConfig = this.buildAggregatedMihomoConfig(
                mainConfigResponse.response,
                publicBaseUrl,
                encodedMainShortUuid,
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

            let subscriptionDataResponse: {
                response: unknown;
                headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
            } | null = null;

            subscriptionDataResponse = await this.axiosService.getSubscription(
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
            this.logger.warn(`Main Remnawave user ${mainShortUuid} not found.`);
            return {
                isMainFound: false,
                fallbackShortUuid: null,
            };
        }

        const fallbackShortUuid = this.parseFallbackShortUuid(
            mainShortUuid,
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
            this.logger.warn(
                `Fallback Remnawave user ${fallbackShortUuid} for main ${mainShortUuid} not found.`,
            );
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

    private parseFallbackShortUuid(
        mainShortUuid: string,
        description: string | null,
    ): string | null {
        if (!description) {
            this.logger.debug(`Main Remnawave user ${mainShortUuid} has empty description.`);
            return null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(description);
        } catch (error) {
            this.logger.warn(
                `Main Remnawave user ${mainShortUuid} has invalid description JSON: ${error}`,
            );
            return null;
        }

        if (!this.isMainMetadataWithFallback(parsed)) {
            this.logger.debug(
                `Main Remnawave user ${mainShortUuid} description has no fallbackShortUuid.`,
            );
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
    ): string {
        const mihomoConfig = this.parseMihomoConfig(mainConfigResponse);
        const mainProviderUrl = `${publicBaseUrl}/provider/main/${encodedMainShortUuid}`;
        const fallbackProviderUrl = `${publicBaseUrl}/provider/fallback/${encodedMainShortUuid}`;
        const healthCheckUrl = 'https://www.gstatic.com/generate_204';
        const mainAutoGroupName = '⚡️ Авто Main';
        const fallbackAutoGroupName = '⚡️ Авто Fallback';

        mihomoConfig['proxy-providers'] = {
            ...(this.isPlainObject(mihomoConfig['proxy-providers'])
                ? mihomoConfig['proxy-providers']
                : {}),
            'main-provider': {
                type: 'http',
                url: mainProviderUrl,
                interval: 3_600,
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
                'health-check': {
                    enable: true,
                    url: healthCheckUrl,
                    interval: 300,
                    timeout: 5_000,
                    lazy: true,
                },
            },
        };

        const proxyGroups = this.getProxyGroups(mihomoConfig);

        this.upsertProxyGroup(proxyGroups, {
            name: mainAutoGroupName,
            type: 'url-test',
            use: ['main-provider'],
            url: healthCheckUrl,
            interval: 300,
            tolerance: 150,
            lazy: true,
            hidden: true,
        });

        this.upsertProxyGroup(proxyGroups, {
            name: fallbackAutoGroupName,
            type: 'url-test',
            use: ['fallback-provider'],
            url: healthCheckUrl,
            interval: 300,
            tolerance: 150,
            lazy: true,
            hidden: true,
        });

        this.upsertProxyGroup(proxyGroups, {
            name: this.mihomoVpnGroupName,
            type: 'fallback',
            proxies: [mainAutoGroupName, fallbackAutoGroupName],
            url: healthCheckUrl,
            interval: 300,
            lazy: true,
        });

        mihomoConfig['proxy-groups'] = proxyGroups;

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

    private getProxyGroups(config: MihomoConfig): MihomoProxyGroup[] {
        const proxyGroups = config['proxy-groups'];

        if (!Array.isArray(proxyGroups)) {
            return [];
        }

        return proxyGroups.filter((group): group is MihomoProxyGroup => {
            if (!this.isPlainObject(group)) {
                return false;
            }

            return typeof group.name === 'string' && typeof group.type === 'string';
        });
    }

    private upsertProxyGroup(proxyGroups: MihomoProxyGroup[], nextGroup: MihomoProxyGroup): void {
        const existingIndex = proxyGroups.findIndex((group) => group.name === nextGroup.name);

        if (existingIndex === -1) {
            proxyGroups.push(nextGroup);
            return;
        }

        proxyGroups[existingIndex] = nextGroup;
    }

    private isPlainObject(value: unknown): value is MihomoConfig {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private getPublicBaseUrl(req: Request): string {
        const configuredBaseUrl = this.configService.get<string | undefined>(
            'SUBSCRIPTION_PUBLIC_BASE_URL',
        );

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
            this.logger.error('Error in returnWebpage', error);

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
        const validFrom = this.configService.get<string | undefined>(
            'MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM',
        );

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
