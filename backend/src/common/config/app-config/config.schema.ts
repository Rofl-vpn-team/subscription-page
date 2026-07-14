import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const booleanString = (def: 'true' | 'false' = 'false') =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val))
        .refine((val) => val === 'true' || val === 'false', 'Must be "true" or "false".')
        .transform((val) => val === 'true')
        .pipe(z.boolean());

const defaultableString = (def: string) =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val));

const optionalNonEmptyString = () =>
    z.preprocess((val) => (val === '' ? undefined : val), z.string().optional());

const positiveIntegerString = (def: string) =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val))
        .refine((val) => /^[1-9]\d*$/.test(val), 'Must be a positive integer.')
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().positive());

const integerRangeString = (def: string, minimum: number, maximum: number) =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val))
        .refine((val) => /^\d+$/.test(val), 'Must be an integer.')
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(minimum).max(maximum));

const REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE =
    'Remnawave Dashboard → Remnawave Settings → API Tokens. Create a new API Token and set it in the .env file.';

export const configSchema = z
    .object({
        APP_PORT: z
            .string()
            .default('3010')
            .transform((port) => parseInt(port, 10)),
        REMNAWAVE_PANEL_URL: z.string(),
        REMNAWAVE_API_TOKEN: z
            .string({ message: REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE })
            .min(1, REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE),

        SUBPAGE_CONFIG_UUID: z.string().default('00000000-0000-0000-0000-000000000000'),
        CUSTOM_SUB_PREFIX: z.optional(z.string()),
        SUBSCRIPTION_PUBLIC_BASE_URL: z.optional(z.string()),
        HAPP_XRAY_GROUPED_CONFIG_ENABLED: z
            .string()
            .default('false')
            .transform((val) => (val === '' ? 'false' : val))
            .refine((val) => val === 'true' || val === 'false', 'Must be "true" or "false".')
            .transform((val) => val === 'true'),
        HAPP_XRAY_HYSTERIA_ALLOWLIST: z.string().default(''),
        HAPP_XRAY_HYSTERIA_ROLLOUT_MODE: z
            .enum(['off', 'allowlist', 'percentage', 'on'])
            .default('off'),
        HAPP_XRAY_HYSTERIA_ROLLOUT_PERCENT: integerRangeString('0', 0, 100),
        HAPP_XRAY_OBSERVATORY_URL: z.string().default('https://www.gstatic.com/generate_204'),
        HAPP_XRAY_BURST_OBSERVATORY_CONNECTIVITY: z.string().default(''),
        HAPP_XRAY_BURST_OBSERVATORY_DESTINATION: optionalNonEmptyString(),
        HAPP_XRAY_BURST_OBSERVATORY_INTERVAL: defaultableString('2m'),
        HAPP_XRAY_BURST_OBSERVATORY_SAMPLING: positiveIntegerString('3'),
        HAPP_XRAY_BURST_OBSERVATORY_TIMEOUT: defaultableString('3s'),
        HAPP_XRAY_WHITELIST_SUFFIX: z.string().default(' [White Cipher]'),

        CADDY_AUTH_API_TOKEN: z.optional(z.string()),
        CLOUDFLARE_ZERO_TRUST_CLIENT_ID: z.optional(z.string()),
        CLOUDFLARE_ZERO_TRUST_CLIENT_SECRET: z.optional(z.string()),

        MARZBAN_LEGACY_LINK_ENABLED: booleanString(),
        MARZBAN_LEGACY_SECRET_KEY: z.optional(z.string()),
        MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM: z.optional(z.string()),
        MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS: booleanString(),
        INTERNAL_JWT_SECRET: z.string(),
        EGAMES_COOKIE: z.optional(z.string()),
    })
    .superRefine((data, ctx) => {
        if (
            data.HAPP_XRAY_HYSTERIA_ROLLOUT_MODE !== 'off' &&
            !data.HAPP_XRAY_GROUPED_CONFIG_ENABLED
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'HAPP_XRAY_GROUPED_CONFIG_ENABLED must be true when HAPP Xray Hysteria rollout is enabled.',
                path: ['HAPP_XRAY_HYSTERIA_ROLLOUT_MODE'],
            });
        }
        if (
            !data.REMNAWAVE_PANEL_URL.startsWith('http://') &&
            !data.REMNAWAVE_PANEL_URL.startsWith('https://')
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'REMNAWAVE_PANEL_URL must start with http:// or https://',
                path: ['REMNAWAVE_PANEL_URL'],
            });
        }
        const burstObservatoryDestination =
            data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION ?? data.HAPP_XRAY_OBSERVATORY_URL;

        if (
            !burstObservatoryDestination.startsWith('http://') &&
            !burstObservatoryDestination.startsWith('https://')
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'HAPP_XRAY_BURST_OBSERVATORY_DESTINATION must start with http:// or https://',
                path: [
                    data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION
                        ? 'HAPP_XRAY_BURST_OBSERVATORY_DESTINATION'
                        : 'HAPP_XRAY_OBSERVATORY_URL',
                ],
            });
        }
        if (
            data.SUBSCRIPTION_PUBLIC_BASE_URL &&
            !data.SUBSCRIPTION_PUBLIC_BASE_URL.startsWith('http://') &&
            !data.SUBSCRIPTION_PUBLIC_BASE_URL.startsWith('https://')
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'SUBSCRIPTION_PUBLIC_BASE_URL must start with http:// or https://',
                path: ['SUBSCRIPTION_PUBLIC_BASE_URL'],
            });
        }
        if (data.MARZBAN_LEGACY_LINK_ENABLED) {
            if (!data.MARZBAN_LEGACY_SECRET_KEY) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'MARZBAN_LEGACY_SECRET_KEY is required when MARZBAN_LEGACY_LINK_ENABLED is true',
                });
            }
        }
    })
    .transform((data) => ({
        ...data,
        HAPP_XRAY_BURST_OBSERVATORY_DESTINATION:
            data.HAPP_XRAY_BURST_OBSERVATORY_DESTINATION ?? data.HAPP_XRAY_OBSERVATORY_URL,
    }));

export type ConfigSchema = z.infer<typeof configSchema>;
export class Env extends createZodDto(configSchema) {}
