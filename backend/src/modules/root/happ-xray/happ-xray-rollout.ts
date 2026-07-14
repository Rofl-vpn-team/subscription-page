import { createHash } from 'node:crypto';

export type HappHysteriaRolloutMode = 'off' | 'allowlist' | 'percentage' | 'on';

export interface HappHysteriaRolloutConfig {
    allowlist: string[];
    mode: HappHysteriaRolloutMode;
    percentage: number;
}

export function isHappHysteriaSelected(
    shortUuid: string,
    config: HappHysteriaRolloutConfig,
): boolean {
    if (config.mode === 'off') {
        return false;
    }

    if (config.mode === 'on') {
        return true;
    }

    const isAllowlisted = config.allowlist.some((value) => value.trim() === shortUuid);

    if (config.mode === 'allowlist') {
        return isAllowlisted;
    }

    return isAllowlisted || percentageBucket(shortUuid) < config.percentage;
}

function percentageBucket(shortUuid: string): number {
    const prefix = createHash('sha256').update(shortUuid).digest('hex').slice(0, 8);

    return Number.parseInt(prefix, 16) % 100;
}
