import { verify as verifyOtp } from 'otplib';

/**
 * otplib v13 changed its `verify` return type: it used to be a boolean, it is
 * now a `VerifyResult` object shaped `{ valid, delta, epoch, timeStep }`.
 * Because an object is always truthy, `if (!(await verify(...)))` let ANY
 * token pass. Every call site must check `result.valid === true`; this helper
 * is the single place that does, so a future otplib change cannot silently
 * reopen the hole.
 */
export async function verifyTotp(
    token: string,
    secret: string,
    epoch = Date.now() / 1000,
): Promise<boolean> {
    const result = await verifyOtp({ token, secret, epoch, epochTolerance: 30 });
    return result?.valid === true;
}
