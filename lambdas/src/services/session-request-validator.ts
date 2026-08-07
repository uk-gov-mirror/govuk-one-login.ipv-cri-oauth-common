import { JwtVerifier } from "../common/security/jwt-verifier";
import { JWTPayload, errors } from "jose";
import { SessionRequestValidationConfig } from "../types/session-request-validation-config";
import { ClientConfigKey } from "../types/config-keys";
import { Logger } from "@aws-lambda-powertools/logger";
import { SessionValidationError } from "../common/utils/errors";
import { EvidenceRequestSchema } from "../schemas/evidence-request.schema";
import {
    getStorageAccessTokenClaim,
    STORAGE_ACCESS_TOKEN_CLAIM,
    StorageAccessTokenClaimSchema,
    VtrSchema,
} from "../schemas/ipv-request.schema";
import { ZodError, ZodType } from "zod";

type ZodIssue = ZodError["issues"][number];

const describeIssue = (issue: ZodIssue, claimName?: string): string => {
    const path = [...issue.path];

    if (claimName) {
        path.unshift(claimName);
    }

    return `${path.join(".")} - ${issue.message}`;
};

const describeIssues = (issues: readonly ZodIssue[], claimName?: string): string => {
    const described = issues.map((issue) => {
        return describeIssue(issue, claimName);
    });

    return described.join(", ");
};

const missingClaimError = (claimName: string): SessionValidationError => {
    return new SessionValidationError(
        "Session Validation Exception",
        `Invalid request: ${claimName} claim is required and was not provided in the request`,
    );
};

export class SessionRequestValidator {
    constructor(
        private readonly validationConfig: SessionRequestValidationConfig,
        private readonly jwtVerifier: JwtVerifier,
    ) {}
    async validateJwt(jwt: Buffer, requestBodyClientId: string): Promise<JWTPayload> {
        const expectedRedirectUri = this.validationConfig.expectedJwtRedirectUri;

        const payload = await this.verifyJwtSignature(jwt);

        const state = payload["state"] as string;

        if (payload["evidence_requested"] !== undefined) {
            this.validateEvidenceRequested(payload["evidence_requested"]);
        }

        this.validateIpvClaims(payload);

        if (payload.client_id !== requestBodyClientId) {
            throw new SessionValidationError(
                "Session Validation Exception",
                `Invalid request: JWT validation/verification failed: Mismatched client_id in request body (${requestBodyClientId}) & jwt (${payload.client_id})`,
            );
        } else if (!expectedRedirectUri) {
            throw new SessionValidationError(
                "Session Validation Exception",
                `Invalid request: JWT validation/verification failed: Unable to retrieve redirect URI for client_id: ${requestBodyClientId}`,
            );
        } else if (expectedRedirectUri !== payload.redirect_uri) {
            throw new SessionValidationError(
                "Session Validation Exception",
                `Invalid request: JWT validation/verification failed: Redirect uri ${payload.redirect_uri} does not match configuration uri ${expectedRedirectUri}`,
            );
        } else if (!state) {
            throw new SessionValidationError("Session Validation Exception", "Invalid state parameter");
        }

        return payload;
    }

    private validateEvidenceRequested(evidenceRequestedRaw: unknown): void {
        this.parseClaim(EvidenceRequestSchema, evidenceRequestedRaw);
    }

    private validateIpvClaims(payload: JWTPayload): void {
        this.validateIpvClaim(VtrSchema, payload["vtr"], "vtr");

        this.validateIpvClaim(
            StorageAccessTokenClaimSchema,
            getStorageAccessTokenClaim(payload),
            STORAGE_ACCESS_TOKEN_CLAIM,
        );
    }

    private validateIpvClaim(schema: ZodType, claim: unknown, claimName: string): void {
        if (claim !== undefined) {
            this.parseClaim(schema, claim, claimName);

            return;
        }

        if (this.validationConfig.ipvClaimsRequired) {
            throw missingClaimError(claimName);
        }
    }

    private parseClaim(schema: ZodType, claim: unknown, claimName?: string): void {
        const result = schema.safeParse(claim);

        if (!result.success) {
            throw new SessionValidationError(
                "Session Validation Exception",
                `Invalid request: ${describeIssues(result.error.issues, claimName)}`,
            );
        }
    }

    private async verifyJwtSignature(jwt: Buffer): Promise<JWTPayload> {
        const expectedIssuer = this.validationConfig.expectedJwtIssuer;
        const expectedAudience = this.validationConfig.expectedJwtAudience;
        try {
            return await this.jwtVerifier.verify(
                jwt,
                new Set([
                    JwtVerifier.ClaimNames.EXPIRATION_TIME,
                    JwtVerifier.ClaimNames.SUBJECT,
                    JwtVerifier.ClaimNames.NOT_BEFORE,
                    JwtVerifier.ClaimNames.STATE,
                ]),
                new Map([
                    [JwtVerifier.ClaimNames.AUDIENCE, expectedAudience],
                    [JwtVerifier.ClaimNames.ISSUER, expectedIssuer],
                ]),
            );
        } catch (error) {
            const errorDetails = error instanceof errors.JOSEError ? error.code : "JWT verification failure";
            throw new SessionValidationError(
                "Session Validation Exception",
                `Invalid request: JWT validation/verification failed: ${errorDetails}`,
            );
        }
    }
}

export class SessionRequestValidatorFactory {
    constructor(
        private readonly logger: Logger,
        private readonly ipvClaimsRequired: boolean = false,
    ) {}
    public create(criClientConfig: Map<string, string>): SessionRequestValidator {
        return new SessionRequestValidator(
            {
                expectedJwtRedirectUri: criClientConfig.get(ClientConfigKey.JWT_REDIRECT_URI) as string,
                expectedJwtIssuer: criClientConfig.get(ClientConfigKey.JWT_ISSUER) as string,
                expectedJwtAudience: criClientConfig.get(ClientConfigKey.JWT_AUDIENCE) as string,
                ipvClaimsRequired: this.ipvClaimsRequired,
            },
            new JwtVerifier(
                {
                    jwtSigningAlgorithm: criClientConfig.get(ClientConfigKey.JWT_SIGNING_ALGORITHM) as string,
                    jwksEndpoint: criClientConfig.get(ClientConfigKey.JWKS_ENDPOINT) as string,
                },
                this.logger,
            ),
        );
    }
}
