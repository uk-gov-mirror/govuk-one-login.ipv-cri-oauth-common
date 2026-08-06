import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { SSMProvider } from "@aws-lambda-powertools/parameters/ssm";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { logger } from "@govuk-one-login/cri-logger";
import { UnixMillisecondsTimestamp, UnixSecondsTimestamp } from "@govuk-one-login/cri-types";
import middy, { MiddyfiedHandler } from "@middy/core";
import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { beforeEach, describe, expect, it, MockedObject, vi } from "vitest";
import { ConfigService } from "../../../src/common/config/config-service";
import { RetrieveSessionLambda, SessionItemData } from "../../../src/handlers/retrieve-session-handler";
import initialiseConfigMiddleware from "../../../src/middlewares/config/initialise-config-middleware";
import errorMiddleware from "../../../src/middlewares/error/error-middleware";
import getSessionByIdMiddleware from "../../../src/middlewares/session/get-session-by-id-middleware";
import { SessionService } from "../../../src/services/session-service";
import { CommonConfigKey } from "../../../src/types/config-keys";

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
        const sessionItem: SessionItemData = createMockSessionItemData();
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));

        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);

        expect(result.statusCode).toBe(200);
    });

    it("should return an empty JSON body of their is no field", async () => {
        const sessionItem: SessionItemData = createMockSessionItemData();
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));

        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);

        expect(JSON.parse(result.body)).toEqual({});
    });

    it("should return JSON body of the field is there", async () => {
        const sessionItem: SessionItemData = createMockSessionItemData({
            field1: "field1 contents",
            field2: "field2 contents",
            field3: 123456,
        });
        vi.spyOn(mockDynamoDbClient.prototype, "send").mockImplementationOnce(async () => ({
            Item: sessionItem,
        }));
        const mockEvent = {
            headers: { "session-id": TEST_SESSION_ID },
        } as unknown as APIGatewayProxyEvent;

        const result = await lambdaHandler(mockEvent, {} as Context);

        expect(JSON.parse(result.body)).toEqual({
            field1: "field1 contents",
            field2: "field2 contents",
            field3: 123456,
        });
    });
});

const createMockSessionItemData = (data?: Record<string, unknown>): SessionItemData => ({
    sessionId: TEST_SESSION_ID,
    attemptCount: 1,
    clientId: "test-client-id",
    clientSessionId: "test-client-session-id",
    createdDate: 0 as UnixMillisecondsTimestamp,
    expiryDate: 0 as UnixSecondsTimestamp,
    redirectUri: "https://www.example.com",
    state: "test-state",
    subject: "test-subject",
    ...(data && { sessionData: data }),
});
