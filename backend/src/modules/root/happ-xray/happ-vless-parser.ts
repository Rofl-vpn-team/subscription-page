import { HappParsedVlessLink } from './happ-xray.types';

export function parseHappVlessLine(line: string): HappParsedVlessLink {
    const trimmed = line.trim();

    if (!trimmed.startsWith('vless://')) {
        throw new Error('Only vless:// links are supported for grouped Happ Xray output.');
    }

    let url: URL;

    try {
        url = new URL(trimmed);
    } catch {
        throwInvalidVlessLink(trimmed);
    }

    let id: string;
    let remark: string;

    try {
        id = decodeURIComponent(url.username);
        remark = decodeRemark(url.hash);
    } catch {
        throwInvalidVlessLink(trimmed);
    }

    const address = url.hostname;
    const port = Number.parseInt(url.port, 10);
    const query = Object.fromEntries(url.searchParams.entries());

    if (!id || !address || !Number.isInteger(port)) {
        throwInvalidVlessLink(trimmed);
    }

    return {
        address,
        id,
        port,
        query,
        remark,
        raw: trimmed,
    };
}

function decodeRemark(hash: string): string {
    const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const decoded = decodeURIComponent(withoutHash);

    return decoded.split('?serverDescription=')[0];
}

function redactLink(link: string): string {
    try {
        const url = new URL(link);
        return `${url.protocol}//<redacted>@${url.host}${url.pathname}`;
    } catch {
        return link.replace(/\/\/[^@]*(?:@|$)/, '//<redacted>@');
    }
}

function throwInvalidVlessLink(link: string): never {
    throw new Error(`Invalid VLESS link: ${redactLink(link)}`);
}
