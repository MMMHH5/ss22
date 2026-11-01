import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecret, generateSync } from 'otplib';
import { verifyTotp } from '../src/common/totp';

test('TOTP accepts codes within the 30-second clock-drift window', async () => {
    const secret = generateSecret();
    const epoch = 1_700_000_015;
    const currentCode = generateSync({ secret, epoch });
    const adjacentCode = generateSync({ secret, epoch: epoch + 20 });

    assert.equal(await verifyTotp(currentCode, secret, epoch), true);
    assert.equal(await verifyTotp(adjacentCode, secret, epoch), true);
});

test('TOTP rejects invalid codes and codes outside the drift window', async () => {
    const secret = generateSecret();
    const epoch = 1_700_000_015;
    const staleCode = generateSync({ secret, epoch: epoch + 90 });

    assert.equal(await verifyTotp('000000', secret, epoch), false);
    assert.equal(await verifyTotp(staleCode, secret, epoch), false);
});
