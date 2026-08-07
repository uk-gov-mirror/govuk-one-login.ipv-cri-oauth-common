export interface SessionRequestValidationConfig {
    expectedJwtRedirectUri: string;
    expectedJwtIssuer: string;
    expectedJwtAudience: string;
    ipvClaimsRequired: boolean;
}
