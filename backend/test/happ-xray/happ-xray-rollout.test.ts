import assert from 'node:assert/strict';
import test from 'node:test';

import { isHappHysteriaSelected } from '@modules/root/happ-xray';

test('Happ Hysteria rollout modes honor off, allowlist, and on semantics', () => {
    assert.equal(
        isHappHysteriaSelected('u1', {
            allowlist: ['u1'],
            mode: 'off',
            percentage: 100,
        }),
        false,
    );
    assert.equal(
        isHappHysteriaSelected('u1', {
            allowlist: ['u1'],
            mode: 'allowlist',
            percentage: 0,
        }),
        true,
    );
    assert.equal(
        isHappHysteriaSelected('u2', {
            allowlist: ['u1'],
            mode: 'allowlist',
            percentage: 0,
        }),
        false,
    );
    assert.equal(
        isHappHysteriaSelected('u1', {
            allowlist: [],
            mode: 'on',
            percentage: 0,
        }),
        true,
    );
});

test('percentage rollout is deterministic and keeps the allowlist authoritative', () => {
    const shortUuids = Array.from({ length: 1_000 }, (_, index) => `stable-user-${index}`);
    const config = {
        allowlist: ['always-selected'],
        mode: 'percentage' as const,
        percentage: 37,
    };
    const firstSelection = shortUuids.map((shortUuid) => isHappHysteriaSelected(shortUuid, config));
    const secondSelection = shortUuids.map((shortUuid) =>
        isHappHysteriaSelected(shortUuid, config),
    );

    assert.deepEqual(secondSelection, firstSelection);
    assert.equal(isHappHysteriaSelected('always-selected', config), true);
    assert.equal(firstSelection.some(Boolean), true);
    assert.equal(
        firstSelection.some((selected) => !selected),
        true,
    );
});

test('percentage rollout has exact boundary behavior', () => {
    const shortUuids = Array.from({ length: 1_000 }, (_, index) => `boundary-user-${index}`);

    assert.equal(
        shortUuids.some((shortUuid) =>
            isHappHysteriaSelected(shortUuid, {
                allowlist: [],
                mode: 'percentage',
                percentage: 0,
            }),
        ),
        false,
    );
    assert.equal(
        isHappHysteriaSelected('allowlisted-at-zero', {
            allowlist: [' allowlisted-at-zero '],
            mode: 'percentage',
            percentage: 0,
        }),
        true,
    );
    assert.equal(
        shortUuids.every((shortUuid) =>
            isHappHysteriaSelected(shortUuid, {
                allowlist: [],
                mode: 'percentage',
                percentage: 100,
            }),
        ),
        true,
    );
});
