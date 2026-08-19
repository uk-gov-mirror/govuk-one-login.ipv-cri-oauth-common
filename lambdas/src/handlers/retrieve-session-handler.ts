import middy from "@middy/core";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { LambdaInterface } from "@aws-lambda-powertools/commons/types";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { logger } from "@govuk-one-login/cri-logger";
import errorMiddleware from "../middlewares/error/error-middleware";
import { captureMetric, metrics } from "@govuk-one-login/cri-metrics";
import getSessionByIdMiddleware from "../middlewares/session/get-session-by-id-middleware";
import initialiseConfigMiddleware from "../middlewares/config/initialise-config-middleware";
import { CommonConfigKey } from "../types/config-keys";
import { ConfigService } from "../common/config/config-service";
import { SessionService } from "../services/session-service";
import { SSMProvider } from "@aws-lambda-powertools/parameters/ssm";
import { AwsClientType, createClient } from "../common/aws-client-factory";
import { OAuthSessionItem } from "../types/oauth-session-item";

const dynamoDbClient = createClient(AwsClientType.DYNAMO);
const SESSION_RETRIEVED_METRIC = "session_retrieved";
const ALLOWED_SESSION_FIELDS = [
    "vtr",
    "storageAccessToken",
    "clientSessionId",
    "persistentSessionId",
    "subject",
    "context",
    "sessionData",
] as const;

export class RetrieveSessionLambda implements LambdaInterface {
    private readonly sessionService: SessionService;
    private readonly configService: ConfigService;

    getSessionService() {
        return this.sessionService;
    }
    getConfigService() {
        return this.configService;
    }

    constructor(configService?: ConfigService, sessionService?: SessionService) {
        this.configService =
            configService || new ConfigService(new SSMProvider({ awsSdkV3Client: createClient(AwsClientType.SSM) }));
        this.sessionService = sessionService || new SessionService(dynamoDbClient, this.configService);
    }

    @metrics.logMetrics({ throwOnEmptyMetrics: false, captureColdStartMetric: true })
    public async handler(_event: APIGatewayProxyEvent, _context: unknown): Promise<APIGatewayProxyResult> {
        logger.info("RetrieveSession lambda triggered", { event: _event });
        const sessionItem = _event.body as never as OAuthSessionItem;
        const responseBody = Object.fromEntries(ALLOWED_SESSION_FIELDS.map((key) => [key, sessionItem[key]]));

        captureMetric(SESSION_RETRIEVED_METRIC);

        return {
            statusCode: 200,
            body: JSON.stringify(responseBody),
        };
    }
}

const handlerClass = new RetrieveSessionLambda();

export const lambdaHandler = middy(handlerClass.handler.bind(handlerClass))
    .use(
        errorMiddleware(logger, {
            metric_name: SESSION_RETRIEVED_METRIC,
            message: "RetrieveSession Lambda error occurred",
        }),
    )
    .use(
        initialiseConfigMiddleware({
            configService: handlerClass.getConfigService(),
            config_keys: [CommonConfigKey.SESSION_TABLE_NAME, CommonConfigKey.SESSION_TTL],
        }),
    )
    .use(getSessionByIdMiddleware({ sessionService: handlerClass.getSessionService() }))
    .use(injectLambdaContext(logger, { clearState: true }));
