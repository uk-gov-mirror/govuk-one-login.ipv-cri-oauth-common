import { base64url, decodeJwt, decodeProtectedHeader, JWTPayload } from "jose";
import { z } from "zod";

export const STORAGE_ACCESS_TOKEN_CLAIM = "https://vocab.account.gov.uk/v1/storageAccessToken";

const LEVELS_OF_CONFIDENCE = ["P1", "P2", "P3", "P4"] as const;

export const VtrSchema = z.array(z.enum(LEVELS_OF_CONFIDENCE)).min(1).describe("Levels of confidence");

export type Vtr = z.infer<typeof VtrSchema>;

const signingAlgorithm = (token: string): unknown => {
    try {
        decodeJwt(token);

        return decodeProtectedHeader(token).alg;
    } catch {
        return undefined;
    }
};

const isSigningAlgorithm = (algorithm: unknown): boolean => {
    if (typeof algorithm !== "string") {
        return false;
    }

    if (algorithm.length === 0) {
        return false;
    }

    return algorithm.toLowerCase() !== "none";
};

const hasSignature = (token: string): boolean => {
    const [, , signature] = token.split(".");

    if (!signature) {
        return false;
    }

    try {
        return base64url.decode(signature).length > 0;
    } catch {
        return false;
    }
};

const isSignedJwt = (token: string): boolean => {
    if (!hasSignature(token)) {
        return false;
    }

    return isSigningAlgorithm(signingAlgorithm(token));
};

export const StorageAccessTokenSchema = z
    .string()
    .refine(isSignedJwt, "must be a signed JWT")
    .describe("Storage access token");

export const StorageAccessTokenClaimSchema = z
    .object({
        values: z.array(StorageAccessTokenSchema).length(1, "must contain exactly one storage access token"),
    })
    .describe("The storage access token entry inside the claims");

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
    if (typeof value !== "object") {
        return undefined;
    }

    if (value === null) {
        return undefined;
    }

    return value as Record<string, unknown>;
};

export const getStorageAccessTokenClaim = (payload: JWTPayload): unknown => {
    const claims = asRecord(payload["claims"]);
    const userinfo = asRecord(claims?.["userinfo"]);

    if (!userinfo) {
        return undefined;
    }

    if (!(STORAGE_ACCESS_TOKEN_CLAIM in userinfo)) {
        return undefined;
    }

    return userinfo[STORAGE_ACCESS_TOKEN_CLAIM];
};

export const getStorageAccessToken = (payload: JWTPayload): string | undefined => {
    const claim = StorageAccessTokenClaimSchema.safeParse(getStorageAccessTokenClaim(payload));

    if (!claim.success) {
        return undefined;
    }

    return claim.data.values[0];
};
