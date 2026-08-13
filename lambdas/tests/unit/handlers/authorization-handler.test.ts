import middy from "@middy/core";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { beforeEach, describe, expect, it, MockInstance, vi } from "vitest";

import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { AuthorizationLambda } from "../../../src/handlers/authorization-handler";
import { ConfigService } from "../../../src/common/config/config-service";
import { SessionService } from "../../../src/services/session-service";
import { AuthorizationRequestValidator } from "../../../src/services/auth-request-validator";
import { SessionItem, UnixSecondsTimestamp } from "@govuk-one-login/cri-types";
import {
    APIGatewayProxyEvent,
    APIGatewayProxyEventHeaders,
    APIGatewayProxyEventQueryStringParameters,
} from "aws-lambda/trigger/api-gateway-proxy";
import {
    InvalidRequestError,
    ServerError,
    SessionNotFoundError,
    SessionValidationError,
    AccessDeniedError,
} from "../../../src/common/utils/errors";
import getSessionByIdMiddleware from "../../../src/middlewares/session/get-session-by-id-middleware";
import { ClientConfigKey, CommonConfigKey } from "../../../src/types/config-keys";
import initialiseConfigMiddleware from "../../../src/middlewares/config/initialise-config-middleware";
import errorMiddleware from "../../../src/middlewares/error/error-middleware";
import { Context } from "aws-lambda";
import setGovUkSigningJourneyIdMiddleware from "../../../src/middlewares/session/set-gov-uk-signing-journey-id-middleware";
import initialiseClientConfigMiddleware from "../../../src/middlewares/config/initialise-client-config-middleware";
import setRequestedVerificationScoreMiddleware from "../../../src/middlewares/session/set-requested-verification-score-middleware";
import { SSMProvider } from "@aws-lambda-powertools/parameters/ssm";
import { logger } from "@govuk-one-login/cri-logger";
import { captureMetric } from "@govuk-one-login/cri-metrics";

vi.mock("../../../src/common/config/config-service");
vi.mock("@govuk-one-login/cri-metrics", () => ({
    metrics: {
        addDimension: vi.fn(),
        publishStoredMetrics: vi.fn(),
        logMetrics: vi.fn(),
    },
    captureMetric: vi.fn(),
}));
vi.mock("@govuk-one-login/cri-logger", () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        clearBuffer: vi.fn(),
        resetKeys: vi.fn(),
        refreshSampleRateCalculation: vi.fn(),
        addContext: vi.fn(),
        logEventIfEnabled: vi.fn(),
        appendKeys: vi.fn(),
    },
}));

const AUTHORIZATION_SENT_METRIC = "authorization_sent";

describe("authorization-handler.ts", () => {
    const mockDynamoDbClient = vi.mocked(DynamoDBDocument);
    const metricsSpy = vi.mocked(captureMetric);
    const configService = new ConfigService(vi.fn() as unknown as SSMProvider);
    const sessionService = new SessionService(mockDynamoDbClient.prototype, configService);
    const authorizationRequestValidator = new AuthorizationRequestValidator();
    const mockConfigService = vi.mocked(ConfigService);

    const sessionItem: Partial<SessionItem> = {
        sessionId: "abc",
        authorizationCodeExpiryDate: 1 as UnixSecondsTimestamp,
        clientId: "1",
        clientSessionId: "1",
        redirectUri: "http://123.com",
        state: "session-state-value",
        accessToken: "",
        accessTokenExpiryDate: 0 as UnixSecondsTimestamp,
        authorizationCode: "abc",
    };

    const buildLambdaHandler = () => {
        const handlerClass = new AuthorizationLambda(authorizationRequestValidator);
        return middy(handlerClass.handler.bind(handlerClass))
            .use(
                errorMiddleware(logger, {
                    metric_name: AUTHORIZATION_SENT_METRIC,
                    message: "Authorization Lambda error occurred",
                }),
            )
            .use(injectLambdaContext(logger, { clearState: true }))
            .use(
                initialiseConfigMiddleware({
                    configService: configService,
                    config_keys: [CommonConfigKey.SESSION_TABLE_NAME],
                }),
            )
            .use(getSessionByIdMiddleware({ sessionService: sessionService }))
            .use(
                initialiseClientConfigMiddleware({
                    configService: configService,
                    client_config_keys: [ClientConfigKey.JWT_REDIRECT_URI],
                }),
            )
            .use(setGovUkSigningJourneyIdMiddleware(logger))
            .use(setRequestedVerificationScoreMiddleware(logger));
    };

    beforeEach(() => {
        vi.resetAllMocks();
        delete process.env.ENV_VAR_AUTHORIZATION_REQUEST_TYPE;
        const impl = () => vi.fn().mockImplementation(() => Promise.resolve({ Parameters: [] }));
        mockDynamoDbClient.prototype.send = impl();
        mockDynamoDbClient.prototype.query = impl();
        configService.init = () => Promise.resolve();
        vi.spyOn(sessionService, "getSession").mockResolvedValue(sessionItem as SessionItem);
        const clientConfig = new Map<string, string>();
        clientConfig.set("code", "abc");
        clientConfig.set("redirectUri", "http://123.com");
        vi.spyOn(mockConfigService.prototype, "getClientConfig").mockReturnValue(clientConfig);
    });

    describe("Authorization handler with the Authorization Request Type feature flag set to CRI", () => {
        let body = {};
        let headers = {};
        let lambdaHandler: middy.MiddyfiedHandler;

        beforeEach(() => {
            process.env.ENV_VAR_AUTHORIZATION_REQUEST_TYPE = "CRI";
            body = {
                code: "",
                grant_type: "authorization_code",
                redirect_uri: "",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: "2",
            };
            headers = {
                "session-id": "1",
            } as APIGatewayProxyEventHeaders;
            lambdaHandler = buildLambdaHandler();
        });

        describe("has queryStringParameters parameters all populated", () => {
            let queryString = {};
            beforeEach(() => {
                queryString = {
                    client_id: "1",
                    redirect_uri: "http://123.com",
                    response_type: "test",
                } as APIGatewayProxyEventQueryStringParameters;
            });
            it("should pass with 200 status code and return non empty body", async () => {
                const loggerSpyAppendkeys = vi.spyOn(logger, "appendKeys");
                const loggerSpyInfo = vi.spyOn(logger, "info");

                const output = await lambdaHandler(
                    {
                        body,
                        headers,
                        queryStringParameters: queryString,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(output.statusCode).toBe(200);
                expect(output.body).not.toBeNull();
                expect(loggerSpyInfo).toHaveBeenCalledWith("Session found");
                expect(loggerSpyAppendkeys).toHaveBeenCalledWith({ govuk_signin_journey_id: "1" });
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent");
            });

            it("should pass with log message and metrics sent", async () => {
                const loggerSpyAppendkeys = vi.spyOn(logger, "appendKeys");
                const loggerSpyInfo = vi.spyOn(logger, "info");

                await lambdaHandler(
                    {
                        body,
                        headers,
                        queryStringParameters: queryString,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(loggerSpyInfo).toHaveBeenCalledWith("Session found");
                expect(loggerSpyAppendkeys).toHaveBeenCalledWith({ govuk_signin_journey_id: "1" });
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent");
            });
        });

        describe("authorization request returns access_denied", () => {
            let loggerSpyError: MockInstance;
            beforeEach(() => {
                loggerSpyError = vi.spyOn(logger, "error");
                vi.spyOn(sessionService, "getSession").mockResolvedValueOnce({
                    ...sessionItem,
                    authorizationCode: undefined,
                } as SessionItem);
            });
            it("should return 403 status code and return body with access_denied", async () => {
                const result = await lambdaHandler(
                    {
                        body: body,
                        headers: headers,
                        queryStringParameters: {
                            client_id: "1",
                            redirect_uri: "http://123.com",
                            response_type: "a_response_type",
                        },
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(result).toEqual({
                    statusCode: 403,
                    body: JSON.stringify({
                        message: "Authorization permission denied",
                        code: "access_denied",
                        errorSummary: "access_denied: Authorization permission denied",
                    }),
                });
                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: access_denied: Authorization permission denied",
                    expect.any(AccessDeniedError),
                );
                expect(metricsSpy).toHaveBeenCalledWith("no_authorization_code");
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
        });

        describe("authorization request has missing attributes", () => {
            let loggerSpyError: MockInstance;
            beforeEach(() => {
                loggerSpyError = vi.spyOn(logger, "error");
            });

            it("should fail validation when response_type is missing from queryString", async () => {
                const queryString = {
                    client_id: "1",
                    redirect_uri: "http://123.com",
                } as APIGatewayProxyEventQueryStringParameters;

                const output = await lambdaHandler(
                    {
                        body: body,
                        headers: headers,
                        queryStringParameters: queryString,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(output.statusCode).toBe(400);
                expect(output.body).toContain("Session Validation Exception");

                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: 1019: Session Validation Exception - Missing response_type parameter",
                    expect.any(SessionValidationError),
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
            it("should fail validation when the redirect_uri is missing from from queryString", async () => {
                const queryString = {
                    client_id: "1",
                    response_type: "test",
                } as APIGatewayProxyEventQueryStringParameters;

                const output = await lambdaHandler(
                    {
                        body: body,
                        headers: headers,
                        queryStringParameters: queryString,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(output.statusCode).toBe(400);
                expect(output.body).toContain("Session Validation Exception");

                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: 1019: Session Validation Exception - Missing redirect_uri parameter",
                    expect.any(SessionValidationError),
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
            it("should fail validation when the client_id is missing from queryString", async () => {
                const queryString = {
                    redirect_uri: "http://123.com",
                    response_type: "test",
                } as APIGatewayProxyEventQueryStringParameters;

                const output = await lambdaHandler(
                    {
                        body: body,
                        headers: headers,
                        queryStringParameters: queryString,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );

                expect(output.statusCode).toBe(400);
                expect(output.body).toContain("Session Validation Exception");

                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: 1019: Session Validation Exception - Missing client_id parameter",
                    expect.any(SessionValidationError),
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
        });

        describe("has session present", () => {
            it("should fail when there is no session-id in the authorization request header", async () => {
                const loggerSpyError = vi.spyOn(logger, "error");
                const output = await lambdaHandler(
                    {
                        body,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );
                expect(output.statusCode).toBe(400);
                expect(output.body).toContain("Invalid request: Missing session-id header");
                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: Invalid request: Missing session-id header",
                    expect.any(InvalidRequestError),
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
            it("should fail when no existing session is found for the current request", async () => {
                const loggerSpyError = vi.spyOn(logger, "error");
                const sessionId = "1";
                const sessionNotFound = new SessionNotFoundError(sessionId);
                vi.spyOn(sessionService, "getSession").mockRejectedValueOnce(sessionNotFound);

                const output = await lambdaHandler(
                    {
                        body,
                        headers,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );
                expect(output.statusCode).toBe(400);
                expect(output.body).toContain(`Could not find session item with id: ${sessionId}`);
                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: 1029: Could not find session item with id: 1",
                    sessionNotFound,
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });

            it("should fail when a server error occurs", async () => {
                const loggerSpyError = vi.spyOn(logger, "error");
                const serverError = new ServerError();
                vi.spyOn(sessionService, "getSession").mockRejectedValueOnce(serverError);

                const output = await lambdaHandler(
                    {
                        body,
                        headers,
                    } as unknown as APIGatewayProxyEvent,
                    {} as Context,
                );
                expect(output.statusCode).toBe(500);
                expect(output.body).toContain("Server error");
                expect(loggerSpyError).toHaveBeenCalledWith(
                    "Authorization Lambda error occurred: Server error",
                    serverError,
                );
                expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
            });
        });
    });

    describe("Authorization handler with the Authorization Request Type feature flag set to IPV", () => {
        let lambdaHandler: middy.MiddyfiedHandler;

        beforeEach(() => {
            process.env.ENV_VAR_AUTHORIZATION_REQUEST_TYPE = "IPV";
            lambdaHandler = buildLambdaHandler();
        });

        it("should return 200 with state, redirectUri, and authorizationCode from session when no query parameters provided", async () => {
            const output = await lambdaHandler(
                {
                    body: {},
                    headers: { "session-id": "1" },
                    queryStringParameters: null,
                } as unknown as APIGatewayProxyEvent,
                {} as Context,
            );

            expect(output.statusCode).toBe(200);
            const body = JSON.parse(output.body);
            expect(body.state.value).toBe("session-state-value");
            expect(body.redirectionURI).toBe("http://123.com");
            expect(body.authorizationCode.value).toBe("abc");
            expect(metricsSpy).toHaveBeenCalledWith("authorization_sent");
        });

        it("should return 200 with state, redirectUri, and authorizationCode from session even when query parameters are provided", async () => {
            const output = await lambdaHandler(
                {
                    body: {},
                    headers: { "session-id": "1" },
                    queryStringParameters: {
                        client_id: "query-client-id",
                        redirect_uri: "http://query-url.com",
                        state: "query-state",
                    },
                } as unknown as APIGatewayProxyEvent,
                {} as Context,
            );

            expect(output.statusCode).toBe(200);
            const body = JSON.parse(output.body);
            expect(body.state.value).toBe("session-state-value");
            expect(body.redirectionURI).toBe("http://123.com");
        });

        it("should not call the authorizationRequestValidator's validate function'", async () => {
            const validateSpy = vi.spyOn(authorizationRequestValidator, "validate");

            await lambdaHandler(
                {
                    body: {},
                    headers: { "session-id": "1" },
                    queryStringParameters: null,
                } as unknown as APIGatewayProxyEvent,
                {} as Context,
            );

            expect(validateSpy).not.toHaveBeenCalled();
        });

        it("should return 403 access_denied when the session has no authorization code", async () => {
            vi.spyOn(sessionService, "getSession").mockResolvedValueOnce({
                ...sessionItem,
                authorizationCode: undefined,
            } as SessionItem);

            const output = await lambdaHandler(
                {
                    body: {},
                    headers: { "session-id": "1" },
                    queryStringParameters: null,
                } as unknown as APIGatewayProxyEvent,
                {} as Context,
            );

            expect(output.statusCode).toBe(403);
            expect(output.body).toContain("access_denied");
            expect(metricsSpy).toHaveBeenCalledWith("no_authorization_code");
            expect(metricsSpy).toHaveBeenCalledWith("authorization_sent", 0);
        });
    });
});
