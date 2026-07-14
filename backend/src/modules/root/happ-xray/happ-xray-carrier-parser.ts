import { z } from 'zod';

import {
    HappResolvedCandidate,
    HappResolvedGroup,
    HappResolvedProxyOutbound,
    HappTier,
} from './happ-xray.types';
import { normalizeHappGroupName } from './happ-xray-grouping';

interface ParseHappXrayCarrierOptions {
    tier: HappTier;
    whitelistSuffix: string;
}

const vlessOutboundSchema = z
    .object({
        mux: z.record(z.unknown()).optional(),
        protocol: z.literal('vless'),
        settings: z
            .object({
                vnext: z.array(z.unknown()).min(1),
            })
            .passthrough(),
        streamSettings: z
            .object({
                network: z.string().min(1),
            })
            .passthrough(),
        tag: z.string().min(1),
    })
    .passthrough();

const hysteriaOutboundSchema = z
    .object({
        mux: z.record(z.unknown()).optional(),
        protocol: z.literal('hysteria'),
        settings: z
            .object({
                address: z.string().min(1),
                port: z.number().int().min(1).max(65_535),
                version: z.literal(2),
            })
            .passthrough(),
        streamSettings: z
            .object({
                hysteriaSettings: z.object({
                    auth: z.string().min(1),
                    version: z.literal(2),
                }),
                network: z.literal('hysteria'),
                security: z.literal('tls'),
                tlsSettings: z.record(z.unknown()),
            })
            .passthrough(),
        tag: z.string().min(1),
    })
    .passthrough();

const carrierSchema = z.object({
    outbounds: z
        .array(z.discriminatedUnion('protocol', [vlessOutboundSchema, hysteriaOutboundSchema]))
        .min(1),
    remarks: z.string().trim().min(1),
});

export function parseHappXrayCarrier(
    payload: unknown,
    options: ParseHappXrayCarrierOptions,
): HappResolvedGroup[] {
    if (!Array.isArray(payload)) {
        throw new Error('HAPP XRAY_JSON carrier payload must be an array.');
    }

    const groups = new Map<
        string,
        { candidatesByIdentity: Map<string, HappResolvedCandidate> } & HappResolvedGroup
    >();

    payload.forEach((value, carrierIndex) => {
        const parsed = carrierSchema.safeParse(value);

        if (!parsed.success) {
            throw new Error(`Invalid HAPP XRAY_JSON carrier[${carrierIndex}].`);
        }

        const groupName = normalizeHappGroupName(
            parsed.data.remarks,
            options.tier,
            options.whitelistSuffix,
        );
        const groupKey = `${options.tier}:${groupName}`;
        let group = groups.get(groupKey);

        if (!group) {
            group = {
                candidates: [],
                candidatesByIdentity: new Map(),
                groupName,
                tier: options.tier,
            };
            groups.set(groupKey, group);
        }

        for (const parsedOutbound of parsed.data.outbounds) {
            const outbound = parsedOutbound as HappResolvedProxyOutbound;
            const identity = buildOutboundIdentity(outbound);

            if (!group.candidatesByIdentity.has(identity)) {
                const candidate = {
                    identity,
                    outbound,
                    protocol: outbound.protocol,
                };
                group.candidatesByIdentity.set(identity, candidate);
                group.candidates.push(candidate);
            }
        }
    });

    return [...groups.values()].map((group) => ({
        candidates: group.candidates,
        groupName: group.groupName,
        tier: group.tier,
    }));
}

function buildOutboundIdentity(outbound: HappResolvedProxyOutbound): string {
    const identityFields = Object.fromEntries(
        Object.entries(outbound).filter(([key]) => key !== 'tag'),
    );

    return JSON.stringify(sortValue(identityFields));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
        );
    }

    return value;
}
