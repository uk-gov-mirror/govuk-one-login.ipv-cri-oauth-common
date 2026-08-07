import { base64url, JWTPayload } from "jose";
import { describe, expect, it } from "vitest";
import {
    getStorageAccessTokenClaim,
    STORAGE_ACCESS_TOKEN_CLAIM,
    StorageAccessTokenClaimSchema,
    StorageAccessTokenSchema,
    VtrSchema,
} from "../../../src/schemas/ipv-request.schema";
import { A_STORAGE_ACCESS_TOKEN, aJwt } from "../fixtures/storage-access-token";

const encode = (value: object): string => {
    return base64url.encode(JSON.stringify(value));
};

const userinfo = (claim: unknown): JWTPayload => {
    return {
        claims: {
            userinfo: {
                "https://vocab.account.gov.uk/v1/coreIdentityJWT": { essential: true },
                "https://vocab.account.gov.uk/v1/socialSecurityRecord": null,
                [STORAGE_ACCESS_TOKEN_CLAIM]: claim,
            },
        },
    };
};

describe("VtrSchema", () => {
    it.each([[["P1"]], [["P2"]], [["P3"]], [["P4"]], [["P2", "P1"]], [["P1", "P2", "P3", "P4"]]])(
        "accepts %p",
        (vtr) => {
            expect(VtrSchema.safeParse(vtr).success).toBe(true);
        },
    );

    it.each([
        [[], "Too small: expected array to have >=1 items"],
        [["P0"], 'Invalid option: expected one of "P1"|"P2"|"P3"|"P4"'],
        [["P5"], 'Invalid option: expected one of "P1"|"P2"|"P3"|"P4"'],
        [["p2"], 'Invalid option: expected one of "P1"|"P2"|"P3"|"P4"'],
        [[2], 'Invalid option: expected one of "P1"|"P2"|"P3"|"P4"'],
        ["P2", "Invalid input: expected array, received string"],
        [null, "Invalid input: expected array, received null"],
        [{}, "Invalid input: expected array, received object"],
    ])("rejects %p", (vtr, message) => {
        const result = VtrSchema.safeParse(vtr);

        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).toBe(message);
    });
});

describe("StorageAccessTokenSchema", () => {
    it("accepts a signed JWT", () => {
        expect(StorageAccessTokenSchema.safeParse(A_STORAGE_ACCESS_TOKEN).success).toBe(true);
    });

    it.each([
        ["an empty string", ""],
        ["a token with no signature", `${encode({ alg: "ES256" })}.${encode({ sub: "x" })}.`],
        ["a token with only two parts", `${encode({ alg: "ES256" })}.${encode({ sub: "x" })}`],
        ["a token with four parts", `${aJwt()}.a-fourth-part`],
        ["an unsecured token", aJwt({ typ: "JWT", alg: "none" })],
        ["a token with no alg", aJwt({ typ: "JWT" })],
        ["a token whose alg is empty", aJwt({ typ: "JWT", alg: "" })],
        ["a token whose alg is not a string", aJwt({ typ: "JWT", alg: 256 })],
        ["a token whose signature is not base64url", `${encode({ alg: "ES256" })}.${encode({ sub: "x" })}.!!!`],
        ["a token whose header is not JSON", `not-json.${encode({ sub: "x" })}.a-signature`],
        ["a token whose payload is not JSON", `${encode({ alg: "ES256" })}.not-json.a-signature`],
    ])("rejects %s", (_scenario, token) => {
        const result = StorageAccessTokenSchema.safeParse(token);

        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).toBe("must be a signed JWT");
    });

    it.each([[null], [undefined], [1], [{}], [[]]])("rejects the non-string %p", (token) => {
        expect(StorageAccessTokenSchema.safeParse(token).success).toBe(false);
    });
});

describe("StorageAccessTokenClaimSchema", () => {
    it("accepts a claim holding exactly one token", () => {
        expect(StorageAccessTokenClaimSchema.safeParse({ values: [A_STORAGE_ACCESS_TOKEN] }).success).toBe(true);
    });

    it.each([
        [{ values: [] }, "must contain exactly one storage access token"],
        [{ values: [A_STORAGE_ACCESS_TOKEN, A_STORAGE_ACCESS_TOKEN] }, "must contain exactly one storage access token"],
        [{ essential: true }, "Invalid input: expected array, received undefined"],
        [null, "Invalid input: expected object, received null"],
    ])("rejects %p", (claim, message) => {
        const result = StorageAccessTokenClaimSchema.safeParse(claim);

        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).toBe(message);
    });

    it("reports the offending token by path", () => {
        const result = StorageAccessTokenClaimSchema.safeParse({ values: ["not-a-jwt"] });

        expect(result.success).toBe(false);
        expect(result.error!.issues[0].path).toEqual(["values", 0]);
    });

    it("never puts the token value into the error message", () => {
        const result = StorageAccessTokenClaimSchema.safeParse({
            values: [A_STORAGE_ACCESS_TOKEN, A_STORAGE_ACCESS_TOKEN],
        });

        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error!.issues)).not.toContain(A_STORAGE_ACCESS_TOKEN);
    });
});

describe("getStorageAccessTokenClaim", () => {
    it("returns the claim when the JAR asks for it", () => {
        expect(getStorageAccessTokenClaim(userinfo({ values: [A_STORAGE_ACCESS_TOKEN] }))).toEqual({
            values: [A_STORAGE_ACCESS_TOKEN],
        });
    });

    it("distinguishes a null claim from an absent one, so a null fails validation", () => {
        expect(getStorageAccessTokenClaim(userinfo(null))).toBeNull();
    });

    it.each([
        ["there is no claims claim", {}],
        ["claims has no userinfo", { claims: {} }],
        ["userinfo asks for other claims only", { claims: { userinfo: { "…/v1/passport": { essential: true } } } }],
        ["claims is not an object", { claims: "openid" }],
    ])("returns undefined when %s", (_scenario, payload) => {
        expect(getStorageAccessTokenClaim(payload)).toBeUndefined();
    });
});
