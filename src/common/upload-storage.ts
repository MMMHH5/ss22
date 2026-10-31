import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { diskStorage, StorageEngine } from 'multer';
import { join, resolve, sep } from 'path';
import { Transform } from 'stream';

type UploadDestination = (req: Request, file: Express.Multer.File) => string;
type UploadFilename = (req: Request, file: Express.Multer.File) => string;
type StoredMulterFile = Express.Multer.File & { key?: string; signature?: Buffer };

let client: S3Client | undefined;

function objectStorageConfig() {
    const keys = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;
    const configured = keys.filter((key) => Boolean(process.env[key]));
    if (configured.length === 0) return null;
    const missing = keys.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Object storage configuration is incomplete: ${missing.join(', ')}`);
    }

    return {
        endpoint: process.env.R2_ENDPOINT!,
        bucket: process.env.R2_BUCKET!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    };
}

export function isObjectStorageEnabled(): boolean {
    return objectStorageConfig() !== null;
}

function getClient(): S3Client {
    const config = objectStorageConfig();
    if (!config) throw new Error('Object storage is not configured');
    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint: config.endpoint,
            forcePathStyle: true,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
    }
    return client;
}

function getBucket(): string {
    const config = objectStorageConfig();
    if (!config) throw new Error('Object storage is not configured');
    return config.bucket;
}

function objectKey(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new BadRequestException('Invalid upload path');
    }
    return normalized.startsWith('uploads/') ? normalized : `uploads/${normalized}`;
}

function s3Storage(destination: UploadDestination, filename: UploadFilename): StorageEngine {
    return {
        _handleFile(req, file, callback) {
            let directory: string;
            let name: string;
            let key: string;
            let body: Transform;
            let upload: Upload;
            const signature: Buffer[] = [];
            let signatureLength = 0;
            let size = 0;
            try {
                directory = destination(req, file);
                name = filename(req, file);
                key = objectKey(`${directory}/${name}`);
                body = new Transform({
                    transform(chunk: Buffer, _encoding, done) {
                        size += chunk.length;
                        if (signatureLength < 24) {
                            const head = chunk.subarray(0, 24 - signatureLength);
                            signature.push(head);
                            signatureLength += head.length;
                        }
                        done(null, chunk);
                    },
                });
                upload = new Upload({
                    client: getClient(),
                    params: {
                        Bucket: getBucket(),
                        Key: key,
                        Body: body,
                        ContentType: file.mimetype,
                    },
                    queueSize: 2,
                    partSize: 8 * 1024 * 1024,
                    leavePartsOnError: false,
                });
            } catch (error) {
                callback(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            file.stream.once('error', (error) => body.destroy(error));
            file.stream.pipe(body);
            upload.done().then(
                () => callback(null, {
                    destination: directory,
                    filename: name,
                    path: key,
                    key,
                    size,
                    signature: Buffer.concat(signature),
                } as Partial<Express.Multer.File> & { key: string; signature: Buffer }),
                (error: Error) => callback(error),
            );
        },
        _removeFile(_req, file, callback) {
            const key = (file as StoredMulterFile).key;
            if (!key) {
                callback(null);
                return;
            }
            getClient().send(new DeleteObjectCommand({
                Bucket: getBucket(),
                Key: key,
            })).then(() => callback(null), callback);
        },
    };
}

export function createUploadStorage(options: {
    destination: UploadDestination;
    filename: UploadFilename;
}): StorageEngine {
    if (isObjectStorageEnabled()) return s3Storage(options.destination, options.filename);

    return diskStorage({
        destination(req, file, callback) {
            const directory = options.destination(req, file);
            mkdirSync(directory, { recursive: true });
            callback(null, directory);
        },
        filename(req, file, callback) {
            callback(null, options.filename(req, file));
        },
    });
}

export async function removeUploadedFile(file: StoredMulterFile): Promise<void> {
    if (isObjectStorageEnabled()) {
        const key = file.key || file.path;
        if (typeof key !== 'string' || !key) throw new Error('Uploaded file has no storage key');
        await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
        return;
    }

    if (file.path) {
        try {
            await unlink(file.path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
}

export async function removeStoredUpload(path: string): Promise<void> {
    const key = objectKey(path);
    if (isObjectStorageEnabled()) {
        await deleteStoredObject(key);
        return;
    }

    const root = resolve(join(process.cwd(), 'uploads'));
    const filePath = resolve(join(root, key.slice('uploads/'.length)));
    if (!filePath.startsWith(root + sep)) throw new Error('Invalid upload path');
    try {
        await unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

export function uploadUrl(file: StoredMulterFile): string {
    const key = file.key || (file.destination && file.filename
        ? `${file.destination}/${file.filename}`
        : file.path);
    if (!key) throw new Error('Uploaded file has no storage key');
    return `/${key.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '')}`;
}

export async function getStoredObject(key: string) {
    const result = await getClient().send(new GetObjectCommand({
        Bucket: getBucket(),
        Key: objectKey(key),
    }));
    if (!result.Body) throw new Error(`Object storage returned an empty body for ${key}`);
    return {
        body: result.Body,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
    };
}

export async function storedObjectExists(key: string): Promise<boolean> {
    try {
        await getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: objectKey(key) }));
        return true;
    } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw error;
    }
}

export function isMissingStoredObject(error: unknown): boolean {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return status === 404;
}

export async function deleteStoredObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey(key) }));
}
