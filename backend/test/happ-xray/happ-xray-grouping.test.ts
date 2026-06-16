import assert from 'node:assert/strict';
import test from 'node:test';

import { groupHappLinks } from '../../src/modules/root/happ-xray';

const baseLink = {
    address: 'bridge.example',
    id: '11111111-1111-4111-8111-111111111111',
    port: 443,
    query: { encryption: 'none', security: 'reality', type: 'raw' },
    raw: 'vless://redacted',
};

test('groupHappLinks groups MAIN and White Cipher separately', () => {
    const groups = groupHappLinks(
        [
            { ...baseLink, remark: '⚡ Авто 1' },
            { ...baseLink, remark: '⚡ Авто 2' },
            { ...baseLink, remark: '🇳🇱 Нидерланды 1' },
            { ...baseLink, remark: '⚡ Авто 1 [White Cipher]' },
            { ...baseLink, remark: '🇳🇱 Нидерланды 1 [White Cipher]' },
        ],
        { whitelistSuffix: ' [White Cipher]' },
    );

    assert.deepEqual(
        groups.map((group) => group.groupName),
        ['⚡ Авто', '🇳🇱 Нидерланды', '⚡ Авто [White Cipher]', '🇳🇱 Нидерланды [White Cipher]'],
    );
    assert.equal(groups[0].tier, 'MAIN');
    assert.equal(groups[0].balancerTag, 'balancer_MAIN_0');
    assert.equal(groups[0].selectorPrefix, 'out_MAIN_0_');
    assert.equal(groups[2].tier, 'WL');
    assert.equal(groups[2].balancerTag, 'balancer_WL_2');
    assert.equal(groups[2].selectorPrefix, 'out_WL_2_');
    assert.deepEqual(
        groups[0].candidates.map((candidate) => candidate.outboundTag),
        ['out_MAIN_0_1', 'out_MAIN_0_2'],
    );
    assert.deepEqual(groups[2].candidates.map((candidate) => candidate.outboundTag), [
        'out_WL_2_1',
    ]);
});

test('groupHappLinks normalizes emoji variation selector in auto label', () => {
    const groups = groupHappLinks(
        [
            { ...baseLink, remark: '⚡️ Авто 1' },
            { ...baseLink, remark: '⚡ Авто 2' },
        ],
        { whitelistSuffix: ' [White Cipher]' },
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].groupName, '⚡ Авто');
    assert.equal(groups[0].candidates.length, 2);
});
