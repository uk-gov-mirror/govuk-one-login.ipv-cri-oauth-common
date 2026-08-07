import { Logger } from "@aws-lambda-powertools/logger";
import { errors, JWTPayload } from "jose";
import { JwtVerifier } from "../../../src/common/security/jwt-verifier";
import {
    SessionRequestValidator,
    SessionRequestValidatorFactory,
} from "../../../src/services/session-request-validator";
import { ClientConfigKey } from "../../../src/types/config-keys";
import { PersonIdentity } from "../../../src/types/person-identity";
import { SessionRequestValidationConfig } from "../../../src/types/session-request-validation-config";
import { STORAGE_ACCESS_TOKEN_CLAIM } from "../../../src/schemas/ipv-request.schema";
import { A_STORAGE_ACCESS_TOKEN, AN_UNSIGNED_TOKEN } from "../fixtures/storage-access-token";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("session-request-validator.ts", () => {
    const logger = new Logger();
    const mockMap = new Map<string, string>();
    mockMap.set("session-id", "test-session-id");
    const personIdentity = vi.mocked({} as PersonIdentity);
    const jwtVerifier = vi.mocked(JwtVerifier);

    describe("SessionRequestValidator", () => {
        let sessionRequestValidatorFactory: SessionRequestValidatorFactory;
        let sessionRequestValidator: SessionRequestValidator;

        beforeEach(() => {
            sessionRequestValidatorFactory = new SessionRequestValidatorFactory(logger);
            sessionRequestValidator = sessionRequestValidatorFactory.create(mockMap);
        });

        it("should return an error on JWT verification failure", async () => {
            vi.spyOn(jwtVerifier.prototype, "verify").mockRejectedValue(new Error());

            await expect(
                sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id"),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details: "Invalid request: JWT validation/verification failed: JWT verification failure",
                }),
            );
        });

        it("should return an expired error on JWT Expired failures", async () => {
            vi.spyOn(jwtVerifier.prototype, "verify").mockRejectedValue(new errors.JWTExpired("", {}));

            await expect(
                sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id"),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details: "Invalid request: JWT validation/verification failed: ERR_JWT_EXPIRED",
                }),
            );
        });

        it("should return an error on mismatched client ID", async () => {
            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: "payload-client-id",
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(
                sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id"),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details:
                        "Invalid request: JWT validation/verification failed: Mismatched client_id in request body (request-client-id) & jwt (payload-client-id)",
                }),
            );
        });

        it("should return an error on failure to retrieve redirect URI", async () => {
            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: "request-client-id",
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(
                sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id"),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details:
                        "Invalid request: JWT validation/verification failed: Unable to retrieve redirect URI for client_id: request-client-id",
                }),
            );
        });

        it("should return an error on mismatched redirect URI", async () => {
            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: "request-client-id",
                redirect_uri: "wrong-redirect-uri",
                shared_claims: personIdentity,
            } as JWTPayload);

            mockMap.set(ClientConfigKey.JWT_REDIRECT_URI, "redirect-uri");
            sessionRequestValidator = sessionRequestValidatorFactory.create(mockMap);

            await expect(
                sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id"),
            ).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details:
                        "Invalid request: JWT validation/verification failed: Redirect uri wrong-redirect-uri does not match configuration uri redirect-uri",
                }),
            );
        });

        it("should successfully validate the jwt", async () => {
            const state = "state";
            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: "request-client-id",
                redirect_uri: "redirect-uri",
                state: state,
                shared_claims: personIdentity,
            } as JWTPayload);

            mockMap.set(ClientConfigKey.JWT_REDIRECT_URI, "redirect-uri");
            sessionRequestValidator = sessionRequestValidatorFactory.create(mockMap);

            const response = await sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), "request-client-id");
            expect(response).toEqual({
                client_id: "request-client-id",
                redirect_uri: "redirect-uri",
                state: state,
                shared_claims: personIdentity,
            });
        });
    });

    describe("sessionRequestValidator for di-ipv-cri-check-hmrc-api", () => {
        let sessionRequestValidator: SessionRequestValidator;
        let sessionRequestValidationConfig: SessionRequestValidationConfig;
        const jwtVerifier = vi.mocked(JwtVerifier);

        beforeEach(() => {
            sessionRequestValidationConfig = {
                expectedJwtRedirectUri: "redirect-uri",
            } as SessionRequestValidationConfig;

            sessionRequestValidator = new SessionRequestValidator(
                sessionRequestValidationConfig,
                jwtVerifier.prototype,
            );
        });

        it("should pass when jwt body is correct", async () => {
            const client_id = "request-client-id";

            const jwtPayload = {
                client_id: client_id,
                redirect_uri: "redirect-uri",
                state: "state",
                shared_claims: personIdentity,
            } as JWTPayload;

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(jwtPayload);

            const payload = (await sessionRequestValidator.validateJwt(
                Buffer.from("test-jwt"),
                client_id,
            )) as JWTPayload;

            expect(payload).toEqual(jwtPayload);
        });

        it("should pass when strength score is 2 and cri is di-ipv-check-hmrc-api", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";
            const state = "state";

            const previousCriIdentifier = process.env.CRI_IDENTIFIER;
            process.env.CRI_IDENTIFIER = "di-ipv-cri-check-hmrc-api";

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: client_id,
                redirect_uri: redirect_uri,
                state: state,
                evidence_requested: {
                    scoringPolicy: "gpg45",
                    strengthScore: 2,
                },
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).resolves.toEqual(
                expect.objectContaining({
                    evidence_requested: { scoringPolicy: "gpg45", strengthScore: 2 },
                }),
            );

            process.env.CRI_IDENTIFIER = previousCriIdentifier;
        });

        it("should fail to validate the evidence_requested is included and scoringPolicy is not gpg45", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";
            const state = "state";

            vi.spyOn(jwtVerifier.prototype, "verify").mockReturnValue(
                await Promise.resolve({
                    client_id: client_id,
                    redirect_uri: redirect_uri,
                    state: state,
                    evidence_requested: {
                        scoringPolicy: "invalid-scoring-policy",
                    },
                    shared_claims: personIdentity,
                } as JWTPayload),
            );

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details: 'Invalid request: scoringPolicy - Invalid input: expected "gpg45"',
                }),
            );
        });

        it("should pass when the evidence_requested is included and scoringPolicy is gpg45", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";
            const state = "state";

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: client_id,
                redirect_uri: redirect_uri,
                state: state,
                evidence_requested: {
                    scoringPolicy: "gpg45",
                },
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).resolves.toEqual(
                expect.objectContaining({
                    evidence_requested: { scoringPolicy: "gpg45" },
                }),
            );
        });

        it("should pass when the there is no evidence_requested", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";
            const state = "state";

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: client_id,
                redirect_uri: redirect_uri,
                state: state,
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).resolves.toEqual({
                client_id: "request-client-id",
                redirect_uri: "redirect-uri",
                shared_claims: {},
                state: "state",
            });
        });
        it("should fail to validate the jwt if state is missing", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: client_id,
                redirect_uri: redirect_uri,
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).rejects.toThrow(
                expect.objectContaining({
                    message: "Session Validation Exception",
                    details: "Invalid state parameter",
                }),
            );
        });
    });

    describe("isValidVerificationScore tests", () => {
        let sessionRequestValidator: SessionRequestValidator;
        let sessionRequestValidationConfig: SessionRequestValidationConfig;
        const jwtVerifier = vi.mocked(JwtVerifier);

        beforeEach(() => {
            sessionRequestValidationConfig = {
                expectedJwtRedirectUri: "redirect-uri",
            } as SessionRequestValidationConfig;

            sessionRequestValidator = new SessionRequestValidator(
                sessionRequestValidationConfig,
                jwtVerifier.prototype,
            );
        });

        it("should pass when evidence_requested is present, contains fields with values within data vocab allowed ranges and validation is enabled on each field", async () => {
            const client_id = "request-client-id";
            const redirect_uri = "redirect-uri";
            const state = "state";

            vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                client_id: client_id,
                redirect_uri: redirect_uri,
                state: state,
                evidence_requested: {
                    scoringPolicy: "gpg45",
                    strengthScore: 1,
                    validityScore: 1,
                    verificationScore: 1,
                    activityHistoryScore: 1,
                    identityFraudScore: 3,
                },
                shared_claims: personIdentity,
            } as JWTPayload);

            await expect(sessionRequestValidator.validateJwt(Buffer.from("test-jwt"), client_id)).resolves.toEqual(
                expect.objectContaining({
                    evidence_requested: {
                        scoringPolicy: "gpg45",
                        strengthScore: 1,
                        validityScore: 1,
                        verificationScore: 1,
                        activityHistoryScore: 1,
                        identityFraudScore: 3,
                    },
                }),
            );
        });
    });

    describe("IPV claims", () => {
        const jwtVerifier = vi.mocked(JwtVerifier);
        const client_id = "request-client-id";

        const anIpvRequest = (overrides: JWTPayload = {}): JWTPayload =>
            ({
                client_id,
                redirect_uri: "redirect-uri",
                state: "state",
                vtr: ["P2"],
                claims: {
                    userinfo: {
                        "https://vocab.account.gov.uk/v1/coreIdentityJWT": { essential: true },
                        "https://vocab.account.gov.uk/v1/socialSecurityRecord": null,
                        [STORAGE_ACCESS_TOKEN_CLAIM]: { values: [A_STORAGE_ACCESS_TOKEN] },
                    },
                },
                ...overrides,
            }) as JWTPayload;

        const validatorRequiring = (ipvClaimsRequired: boolean) =>
            new SessionRequestValidator(
                { expectedJwtRedirectUri: "redirect-uri", ipvClaimsRequired } as SessionRequestValidationConfig,
                jwtVerifier.prototype,
            );

        const validateJwt = (validator: SessionRequestValidator) =>
            validator.validateJwt(Buffer.from("test-jwt"), client_id);

        describe.each([
            ["CRI stack", false],
            ["IPV stack", true],
        ])("on a %s", (_stackType, ipvClaimsRequired) => {
            it("accepts a full IPV request", async () => {
                const payload = anIpvRequest();
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(ipvClaimsRequired))).resolves.toEqual(payload);
            });

            it("accepts an example request", async () => {
                const payload = {
                    sub: "urn:uuid:123",
                    iss: "orch",
                    response_type: "code",
                    client_id,
                    govuk_signin_journey_id: "abc-def",
                    aud: "https://example.account.gov.uk",
                    nbf: 1720453619,
                    email_address: "test@example.com",
                    vtr: ["P2"],
                    scope: "some scope",
                    claims: {
                        userinfo: {
                            "https://vocab.account.gov.uk/v1/coreIdentityJWT": { essential: true },
                            "https://vocab.account.gov.uk/v1/address": { essential: true },
                            "https://vocab.account.gov.uk/v1/passport": { essential: true },
                            "https://vocab.account.gov.uk/v1/socialSecurityRecord": null,
                            "https://vocab.account.gov.uk/v1/drivingPermit": { essential: true },
                            "https://vocab.account.gov.uk/v1/returnCode": { essential: true },
                            "https://vocab.account.gov.uk/v1/inheritedIdentityJWT": null,
                            [STORAGE_ACCESS_TOKEN_CLAIM]: { values: [A_STORAGE_ACCESS_TOKEN] },
                        },
                    },
                    redirect_uri: "redirect-uri",
                    state: "some-state",
                    exp: 1720454519,
                    iat: 1720453619,
                    jti: "abc-def-123",
                } as JWTPayload;
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(ipvClaimsRequired))).resolves.toEqual(payload);
            });

            it.each([
                [
                    "vtr is not a recognised level of confidence",
                    { vtr: ["P5"] },
                    'Invalid request: vtr.0 - Invalid option: expected one of "P1"|"P2"|"P3"|"P4"',
                ],
                ["vtr is empty", { vtr: [] }, "Invalid request: vtr - Too small: expected array to have >=1 items"],
                [
                    "vtr is a bare string",
                    { vtr: "P2" },
                    "Invalid request: vtr - Invalid input: expected array, received string",
                ],
            ])("rejects a request where %s", async (_scenario, overrides, details) => {
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(anIpvRequest(overrides));

                await expect(validateJwt(validatorRequiring(ipvClaimsRequired))).rejects.toThrow(
                    expect.objectContaining({ message: "Session Validation Exception", details }),
                );
            });

            it.each([
                ["the storage access token is not a JWT", { values: ["an-opaque-bearer-token"] }],
                ["the storage access token is unsigned", { values: [AN_UNSIGNED_TOKEN] }],
                ["there is more than one storage access token", { values: [A_STORAGE_ACCESS_TOKEN, "another"] }],
                ["the storage access token claim is null", null],
                ["the storage access token claim has no values", { essential: true }],
            ])("rejects a request where %s", async (_scenario, claim) => {
                const payload = anIpvRequest();
                (payload.claims as { userinfo: Record<string, unknown> }).userinfo[STORAGE_ACCESS_TOKEN_CLAIM] = claim;
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(ipvClaimsRequired))).rejects.toThrow(
                    expect.objectContaining({
                        message: "Session Validation Exception",
                        details: expect.stringContaining(`Invalid request: ${STORAGE_ACCESS_TOKEN_CLAIM}`),
                    }),
                );
            });
        });

        describe("when the stack serves CRI requests", () => {
            it("accepts a request carrying neither claim", async () => {
                const payload = { client_id, redirect_uri: "redirect-uri", state: "state" } as JWTPayload;
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(false))).resolves.toEqual(payload);
            });

            it("accepts a request whose claims does not ask for a storage access token", async () => {
                const payload = anIpvRequest({
                    claims: { userinfo: { "https://vocab.account.gov.uk/v1/passport": { essential: true } } },
                });
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(false))).resolves.toEqual(payload);
            });
        });

        describe.each([
            ["claims is a number", 1],
            ["claims is a string", "openid"],
            ["claims is null", null],
            ["claims.userinfo is a string", { userinfo: "openid" }],
            ["claims.userinfo is a number", { userinfo: 1 }],
            ["claims.userinfo is null", { userinfo: null }],
        ])("when %s", (_scenario, claims) => {
            it("is accepted on a CRI stack rather than crashing", async () => {
                const payload = anIpvRequest({ claims } as JWTPayload);
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(false))).resolves.toEqual(payload);
            });

            it("fails validation on an IPV stack", async () => {
                const payload = anIpvRequest({ claims } as JWTPayload);
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(true))).rejects.toThrow(
                    expect.objectContaining({
                        message: "Session Validation Exception",
                        details: `Invalid request: ${STORAGE_ACCESS_TOKEN_CLAIM} claim is required and was not provided in the request`,
                    }),
                );
            });
        });

        describe("when the stack serves IPV", () => {
            it("rejects a request with no vtr", async () => {
                const payload = anIpvRequest();
                delete payload.vtr;
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(true))).rejects.toThrow(
                    expect.objectContaining({
                        message: "Session Validation Exception",
                        details: "Invalid request: vtr claim is required and was not provided in the request",
                    }),
                );
            });

            it("rejects a request with no storage access token", async () => {
                const payload = anIpvRequest({ claims: { userinfo: {} } });
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue(payload);

                await expect(validateJwt(validatorRequiring(true))).rejects.toThrow(
                    expect.objectContaining({
                        message: "Session Validation Exception",
                        details: `Invalid request: ${STORAGE_ACCESS_TOKEN_CLAIM} claim is required and was not provided in the request`,
                    }),
                );
            });

            it("rejects a CRI request, which carries neither claim", async () => {
                vi.spyOn(jwtVerifier.prototype, "verify").mockResolvedValue({
                    client_id,
                    redirect_uri: "redirect-uri",
                    state: "state",
                    shared_claims: personIdentity,
                } as JWTPayload);

                await expect(validateJwt(validatorRequiring(true))).rejects.toThrow(
                    expect.objectContaining({
                        message: "Session Validation Exception",
                        details: "Invalid request: vtr claim is required and was not provided in the request",
                    }),
                );
            });
        });
    });

    describe("SessionRequestValidatorFactory", () => {
        let sessionRequestValidatorFactory: SessionRequestValidatorFactory;
        vi.mocked(SessionRequestValidator);
        vi.mocked(JwtVerifier);

        beforeEach(() => {
            sessionRequestValidatorFactory = new SessionRequestValidatorFactory(logger);
        });

        it("should create a session request validator", () => {
            const output = sessionRequestValidatorFactory.create(mockMap);
            expect(output).toBeInstanceOf(SessionRequestValidator);
        });

        it.each([
            ["does not require the IPV claims by default", undefined, false],
            ["does not require the IPV claims when told not to", false, false],
            ["requires the IPV claims when told to", true, true],
        ])("%s", (_scenario, ipvClaimsRequired, expected) => {
            const validator =
                ipvClaimsRequired === undefined
                    ? new SessionRequestValidatorFactory(logger).create(mockMap)
                    : new SessionRequestValidatorFactory(logger, ipvClaimsRequired).create(mockMap);

            expect(validator["validationConfig"].ipvClaimsRequired).toBe(expected);
        });
    });
});
