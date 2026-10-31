import { openSync, readSync, closeSync } from 'fs';

type SignatureCheck = (b: Buffer) => boolean;

const readBytes = (filePath: string, length: number): Buffer => {
    const fd = openSync(filePath, 'r');
    try {
        const b = Buffer.alloc(length);
        const read = readSync(fd, b, 0, length, 0);
        return b.subarray(0, read);
    } finally {
        closeSync(fd);
    }
};

const startsWith = (needle: number[]) => (b: Buffer) =>
    needle.length <= b.length && needle.every((v, i) => b[i] === v);

const MAGIC_SIGNATURES: Record<string, SignatureCheck> = {
    'image/jpeg': startsWith([0xff, 0xd8, 0xff]),
    'image/png': startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(b.toString('latin1', 0, 6)),
    'image/webp': (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
    'video/mp4': (b) => b.toString('latin1', 4, 8) === 'ftyp',
    'video/webm': startsWith([0x1a, 0x45, 0xdf, 0xa3]),
    'video/quicktime': (b) => b.toString('latin1', 4, 8) === 'ftyp' && b.toString('latin1', 8, 12) === 'qt  ',
    'application/pdf': (b) => b.toString('latin1', 0, 5) === '%PDF-',
    'application/msword': startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        (b) => startsWith([0x50, 0x4b, 0x03, 0x04])(b)
            || startsWith([0x50, 0x4b, 0x05, 0x06])(b)
            || startsWith([0x50, 0x4b, 0x07, 0x08])(b),
    'text/plain': () => true,
};

/**
 * Verifies that stored bytes match the MIME type claimed by the upload.
 * Returns true when valid or when no signature is registered, false when the
 * declared type clearly does not match the content.
 */
export function hasValidSignature(filePath: string | Buffer, mimetype: string): boolean {
    const check = MAGIC_SIGNATURES[mimetype];
    if (!check) return true;
    try {
        const head = Buffer.isBuffer(filePath) ? filePath : readBytes(filePath, 24);
        return check(head);
    } catch {
        return false;
    }
}

export function hasValidUploadedSignature(file: {
    path: string;
    signature?: Buffer;
    mimetype: string;
}): boolean {
    return hasValidSignature(file.signature ?? file.path, file.mimetype);
}