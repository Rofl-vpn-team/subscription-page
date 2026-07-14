import { HappGroup, HappGroupedCandidate, HappParsedVlessLink, HappTier } from './happ-xray.types';

interface GroupHappLinksOptions {
    whitelistSuffix: string;
}

export function groupHappLinks(
    links: HappParsedVlessLink[],
    options: GroupHappLinksOptions,
): HappGroup[] {
    const buckets = new Map<string, HappGroupedCandidate[]>();
    const groupOrder: string[] = [];

    for (const link of links) {
        const tier = getTier(link.remark, options.whitelistSuffix);
        const groupName = normalizeHappGroupName(link.remark, tier, options.whitelistSuffix);
        const key = `${tier}:${groupName}`;

        if (!buckets.has(key)) {
            buckets.set(key, []);
            groupOrder.push(key);
        }

        const groupIndex = groupOrder.indexOf(key);
        const candidates = buckets.get(key);

        if (!candidates) {
            throw new Error(`Internal grouping error for ${key}`);
        }

        candidates.push({
            groupName,
            link,
            outboundTag: `out_${tier}_${groupIndex}_${candidates.length + 1}`,
            tier,
        });
    }

    return groupOrder.map((key, groupIndex) => {
        const candidates = buckets.get(key) ?? [];
        const first = candidates[0];

        if (!first) {
            throw new Error(`Empty Happ group ${key}`);
        }

        return {
            balancerTag: `balancer_${first.tier}_${groupIndex}`,
            candidates,
            groupName: first.groupName,
            selectorPrefix: `out_${first.tier}_${groupIndex}_`,
            tier: first.tier,
        };
    });
}

export function normalizeHappGroupName(
    remark: string,
    tier: HappTier,
    whitelistSuffix: string,
): string {
    const baseName = stripBridgeIndex(stripWhitelistSuffix(remark, whitelistSuffix));

    return tier === 'WL' ? `${baseName}${whitelistSuffix}` : baseName;
}

function getTier(remark: string, whitelistSuffix: string): HappTier {
    return normalizeLabel(remark).endsWith(whitelistSuffix) ? 'WL' : 'MAIN';
}

function stripWhitelistSuffix(remark: string, whitelistSuffix: string): string {
    const normalized = normalizeLabel(remark);

    return normalized.endsWith(whitelistSuffix)
        ? normalized.slice(0, -whitelistSuffix.length).trim()
        : normalized;
}

function stripBridgeIndex(remark: string): string {
    return remark.replace(/\s+\d+$/, '').trim();
}

function normalizeLabel(value: string): string {
    return value.replace(/\uFE0F/g, '').trim();
}
