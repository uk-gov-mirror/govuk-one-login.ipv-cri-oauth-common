import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { SSMProvider } from "@aws-lambda-powertools/parameters/ssm";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { logger } from "@govuk-one-login/cri-logger";
import { UnixMillisecondsTimestamp, UnixSecondsTimestamp } from "@govuk-one-login/cri-types";
import middy, { MiddyfiedHandler } from "@middy/core";
import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { beforeEach, describe, expect, it, MockedObject, vi } from "vitest";
import { ConfigService } from "../../../src/common/config/config-service";
import { RetrieveSessionLambda } from "../../../src/handlers/retrieve-session-handler";
import initialiseConfigMiddleware from "../../../src/middlewares/config/initialise-config-middleware";
import errorMiddleware from "../../../src/middlewares/error/error-middleware";
import getSessionByIdMiddleware from "../../../src/middlewares/session/get-session-by-id-middleware";
import { SessionService } from "../../../src/services/session-service";
import { CommonConfigKey } from "../../../src/types/config-keys";
import { OAuthSessionItem } from "../../../src/types/oauth-session-item";

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

const SESSION_RETRIEVED_METRIC = "session_retrieved";
const TEST_SESSION_ID = "test-session-id";

describe("RetrieveSessionLambda", () => {
    let retrieveSessionLambda: RetrieveSessionLambda;
    let sessionService: SessionService;
    let lambdaHandler: MiddyfiedHandler;
    let mockDynamoDbClient: MockedObject<typeof DynamoDBDocument>;
    let configService: ConfigService;

    beforeEach(() => {
        vi.clearAllMocks();

        const impl = () => vi.fn().mockImplementation(() => Promise.resolve({ Parameters: [] }));
        configService = new ConfigService(vi.fn() as unknown as SSMProvider);
        mockDynamoDbClient = vi.mocked(DynamoDBDocument);
        mockDynamoDbClient.prototype.send = impl();
        mockDynamoDbClient.prototype.query = impl();

        retrieveSessionLambda = new RetrieveSessionLambda();
        sessionService = new SessionService(mockDynamoDbClient.prototype, configService);

        configService.init = () => Promise.resolve();
        vi.spyOn(configService, "getConfigEntry").mockReturnValue("test-session-table");

        lambdaHandler = middy(retrieveSessionLambda.handler.bind(retrieveSessionLambda))
            .use(
                errorMiddleware(logger, {
                    metric_name: SESSION_RETRIEVED_METRIC,
                    message: "RetrieveSession Lambda error occurred",
                }),
            )
            .use(
                initialiseConfigMiddleware({
                    configService,
                    config_keys: [CommonConfigKey.SESSION_TABLE_NAME, CommonConfigKey.SESSION_TTL],
                }),
            )
            .use(getSessionByIdMiddleware({ sessionService }))
            .use(injectLambdaContext(logger, { clearState: true }));
    });

    it("should return a 200 response", async () => {
        const sessionItem = createMockSessionItemData();
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));

        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);

        expect(result.statusCode).toBe(200);
    });

    it("should return only vtr, storageAccessToken, clientSessionId, persistentSessionId, subject, context, and sessionData", async () => {
        const sessionItem = createMockSessionItemData({
            field1: "field1 contents",
            field2: "field2 contents",
        });
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));

        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);

        expect(JSON.parse(result.body)).toEqual({
            vtr: ["P2"],
            storageAccessToken: "test-storage-access-token",
            clientSessionId: "test-client-session-id",
            persistentSessionId: "test-persistent-session-id",
            subject: "test-subject",
            context: "test-context",
            sessionData: {
                field1: "field1 contents",
                field2: "field2 contents",
            },
        });
    });

    it("should not include sensitive or non-allowlisted fields in the response", async () => {
        const sessionItem = createMockSessionItemData();
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));

        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);
        const body = JSON.parse(result.body);

        expect(body).not.toHaveProperty("accessToken");
        expect(body).not.toHaveProperty("authorizationCode");
        expect(body).not.toHaveProperty("clientIpAddress");
        expect(body).not.toHaveProperty("state");
        expect(body).not.toHaveProperty("sessionId");
        expect(body).not.toHaveProperty("redirectUri");
        expect(body).not.toHaveProperty("clientId");
    });
});

const createMockSessionItemData = (data?: Record<string, string>): OAuthSessionItem =>
    Object.freeze({
        sessionId: TEST_SESSION_ID,
        attemptCount: 1,
        clientId: "test-client-id",
        clientSessionId: "test-client-session-id",
        createdDate: 0 as UnixMillisecondsTimestamp,
        expiryDate: 0 as UnixSecondsTimestamp,
        redirectUri: "https://www.example.com",
        state: "test-state",
        subject: "test-subject",
        vtr: ["P2"] as OAuthSessionItem["vtr"],
        storageAccessToken: "test-storage-access-token",
        persistentSessionId: "test-persistent-session-id",
        context: "test-context",
        accessToken: "secret-access-token",
        authorizationCode: "secret-auth-code",
        clientIpAddress: "192.168.1.1",
        ...(data && { sessionData: data }),
    });
