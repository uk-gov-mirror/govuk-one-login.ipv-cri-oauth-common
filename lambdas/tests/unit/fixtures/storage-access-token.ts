import { base64url } from "jose";

const segment = (value: object): string => {
    return base64url.encode(JSON.stringify(value));
};

export const aJwt = (header: object = { alg: "ES256" }, signature = "a-signature"): string => {
    return `${segment(header)}.${segment({ sub: "urn:uuid:abc" })}.${signature}`;
};

export const A_STORAGE_ACCESS_TOKEN = aJwt();

export const AN_UNSIGNED_TOKEN = aJwt({ alg: "ES256" }, "");
