import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHappVlessLine } from '../../src/modules/root/happ-xray';

const MAIN_AUTO =
    'vless://11111111-1111-4111-8111-111111111111@auto.bridge.example:443?encryption=none&flow=xtls-rprx-vision&type=raw&security=reality&sni=auto.bridge.example&fp=firefox&pbk=PUBLICKEY&sid=abcdef1234567890&spx=%2F#%E2%9A%A1%20%D0%90%D0%B2%D1%82%D0%BE%201';

const HAPP_SUFFIXED =
    'vless://22222222-2222-4222-8222-222222222222@nl.bridge.example:443?encryption=none&type=raw&security=reality&sni=nl.bridge.example&fp=firefox&pbk=PUBLICKEY2&sid=bbbbbbbbbbbbbbbb#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B%202%20%5BWhite%20Cipher%5D?serverDescription=ignored';

const HAPP_ENCODED_SUFFIXED =
    'vless://33333333-3333-4333-8333-333333333333@de.bridge.example:443?encryption=none&type=raw&security=reality#Remark%3FserverDescription=ignored';

test('parseHappVlessLine parses a Remnawave VLESS link', () => {
    const parsed = parseHappVlessLine(MAIN_AUTO);

    assert.equal(parsed.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(parsed.address, 'auto.bridge.example');
    assert.equal(parsed.port, 443);
    assert.equal(parsed.remark, '⚡ Авто 1');
    assert.equal(parsed.query.encryption, 'none');
    assert.equal(parsed.query.flow, 'xtls-rprx-vision');
    assert.equal(parsed.query.type, 'raw');
    assert.equal(parsed.query.security, 'reality');
    assert.equal(parsed.query.sni, 'auto.bridge.example');
    assert.equal(parsed.query.fp, 'firefox');
    assert.equal(parsed.query.pbk, 'PUBLICKEY');
    assert.equal(parsed.query.sid, 'abcdef1234567890');
    assert.equal(parsed.query.spx, '/');
});

test('parseHappVlessLine removes Happ serverDescription suffix from fragment', () => {
    const parsed = parseHappVlessLine(HAPP_SUFFIXED);

    assert.equal(parsed.id, '22222222-2222-4222-8222-222222222222');
    assert.equal(parsed.address, 'nl.bridge.example');
    assert.equal(parsed.remark, '🇳🇱 Нидерланды 2 [White Cipher]');
});

test('parseHappVlessLine removes percent-encoded Happ serverDescription suffix from fragment', () => {
    const parsed = parseHappVlessLine(HAPP_ENCODED_SUFFIXED);

    assert.equal(parsed.remark, 'Remark');
});

test('parseHappVlessLine rejects unsupported protocols', () => {
    assert.throws(() => parseHappVlessLine('trojan://secret@example.com:443#x'), {
        message: /Only vless:\/\/ links are supported/,
    });
});

test('parseHappVlessLine rejects malformed VLESS links with redacted error', () => {
    assert.throws(() => parseHappVlessLine('vless://%'), {
        message: /Invalid VLESS link: vless:\/\/<redacted>@/,
    });
});

test('parseHappVlessLine rejects malformed username percent-encoding with redacted error', () => {
    assert.throws(() => parseHappVlessLine('vless://%E0%A4%A@example.com:443#x'), {
        message: /Invalid VLESS link: vless:\/\/<redacted>@/,
    });
});

test('parseHappVlessLine rejects malformed remark percent-encoding with redacted error', () => {
    assert.throws(
        () =>
            parseHappVlessLine(
                'vless://44444444-4444-4444-8444-444444444444@example.com:443#%E0%A4%A',
            ),
        {
            message: /Invalid VLESS link: vless:\/\/<redacted>@/,
        },
    );
});

test('parseHappVlessLine redacts query values when reporting malformed links', () => {
    assert.throws(
        () =>
            parseHappVlessLine(
                'vless://44444444-4444-4444-8444-444444444444@example.com:443?security=reality&pbk=PBKSECRET&sid=SIDSECRET#%E0%A4%A',
            ),
        (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /Invalid VLESS link: vless:\/\/<redacted>@example\.com:443/);
            assert.doesNotMatch(error.message, /PBKSECRET/);
            assert.doesNotMatch(error.message, /SIDSECRET/);
            assert.doesNotMatch(error.message, /pbk=/);
            assert.doesNotMatch(error.message, /sid=/);
            return true;
        },
    );
});
