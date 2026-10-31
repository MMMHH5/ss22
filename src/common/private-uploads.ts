import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import {
    deleteStoredObject,
    getStoredObject,
    isObjectStorageEnabled,
    storedObjectExists,
} from './upload-storage';

/**
 * Validate a private upload key and resolve it for the configured storage.
 * Legacy receipt/CV keys remain readable after migration to object storage.
 */
export async function resolvePrivateUpload(dbKey: string, kinds: string[]): Promise<string> {
    const uploadsRoot = resolve(join(process.cwd(), 'uploads'));

    for (const kind of kinds) {
        const privatePrefix = `/uploads/private/${kind}/`;
        const legacyPrefix = `/uploads/${kind}/`;
        const prefix = dbKey.startsWith(privatePrefix) ? privatePrefix
            : dbKey.startsWith(legacyPrefix) ? legacyPrefix
                : null;
        if (!prefix) continue;

        const relative = dbKey.slice(prefix.length);
        if (!relative || relative.includes('..') || relative.includes('\\') || relative.includes('/')) {
            throw new ForbiddenException('Invalid file key');
        }

        const key = dbKey.replace(/^\/+/, '');
        if (isObjectStorageEnabled()) {
            if (!await storedObjectExists(key)) throw new NotFoundException('File not found');
            return `r2://${key}`;
        }

        const base = resolve(join(uploadsRoot, prefix === privatePrefix ? join('private', kind) : kind));
        const absolutePath = resolve(join(base, relative));
        if (!absolutePath.startsWith(base + sep)) {
            throw new ForbiddenException('Invalid file key');
        }
        if (!existsSync(absolutePath)) throw new NotFoundException('File not found');
        return absolutePath;
    }

    throw new NotFoundException('File key not recognized');
}

export async function readPrivateUpload(resolved: string): Promise<Buffer> {
    if (resolved.startsWith('r2://')) {
        const object = await getStoredObject(resolved.slice('r2://'.length));
        return Buffer.from(await object.body.transformToByteArray());
    }
    return readFile(resolved);
}

export async function removePrivateUpload(resolved: string): Promise<void> {
    if (resolved.startsWith('r2://')) {
        await deleteStoredObject(resolved.slice('r2://'.length));
        return;
    }
    await unlink(resolved);
}
