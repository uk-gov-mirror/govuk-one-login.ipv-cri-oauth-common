package gov.uk.di.ipv.cri.common.api.stepDefinitions;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.uk.di.ipv.cri.common.api.util.DynamoDBUtil;
import gov.uk.di.ipv.cri.common.api.util.IpvCoreStubUtil;
import io.cucumber.java.en.And;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;

import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.io.IOException;
import java.net.URISyntaxException;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

import static gov.uk.di.ipv.cri.common.api.util.IpvCoreStubUtil.sendCreateAuthCodeRequest;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class APISteps {
    private static final Logger LOG = Logger.getLogger(APISteps.class.getName());
    private static final String ENVIRONMENT = "/dev"; // dev, build, staging, integration
    private static String devSessionUri;
    private static String devAuthorizationUri;
    public static String devAccessTokenUri;
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final String REDIRECT_URI = System.getenv("IPV_CORE_STUB_URL");
    private static final String DEFAULT_REDIRECT_URI =
            (REDIRECT_URI.toLowerCase().startsWith("http"))
                    ? REDIRECT_URI + "/callback"
                    : "https://cri.core.build.stubs.account.gov.uk/callback";
    private static final String DEFAULT_CLIENT_ID =
            System.getenv().getOrDefault("DEFAULT_CLIENT_ID", "ipv-core-stub-aws-build");
    private static final boolean OAUTH_TABLES =
            Boolean.parseBoolean(System.getenv().getOrDefault("OAUTH_TABLES", "true"));
    private static final boolean COMMON_LAMBDAS_TABLES =
            Boolean.parseBoolean(System.getenv().getOrDefault("COMMON_LAMBDAS_TABLES", "false"));
    private static final String PERSON_IDENTITY_TABLE_NAME = System.getenv("PERSON_IDENTITY_TABLE_NAME");
    private static final String SESSION_TABLE_NAME = System.getenv("SESSION_TABLE_NAME");
    private static final boolean IPV_CLAIMS_REQUIRED =
            "IPV".equals(System.getenv().getOrDefault("AUTHORIZATION_REQUEST_TYPE", "CRI"));
    private static final String STORAGE_ACCESS_TOKEN_CLAIM =
            "https://vocab.account.gov.uk/v1/storageAccessToken";
    private static final String A_STORAGE_ACCESS_TOKEN = aSignedJwt();
    private static final List<String> A_VTR = List.of("P2");
    private String currentAuthorizationCode;
    private String sessionUpdateRequestBody;
    private String sessionRequestBody;
    private String currentSessionId;
    private HttpResponse<String> response;
    private Map<String, String> responseBodyMap;
    private Map<String, String> sessionUpdateRequestBodyMap;

    @Given("authorization JAR for test user {int}")
    public void setAuthorizationJARForTestUser(int rowNumber)
            throws URISyntaxException, IOException, InterruptedException {
        String userIdentityJson = IpvCoreStubUtil.getClaimsForUser(rowNumber);
        sessionRequestBody = IpvCoreStubUtil.sendCreateSessionRequest(userIdentityJson);
    }

    @Given("the Session lambda is called")
    public void setSessionEndpoint() {
        devSessionUri = ENVIRONMENT + "/session";
    }

    @Given("the Authorisation lambda is called")
    public void setAuthorizationEndpoint() {
        devAuthorizationUri = ENVIRONMENT + "/authorization";
    }

    @Given("the AccessToken lambda is called")
    public void setAccessTokenEndpoint() {
        devAccessTokenUri = ENVIRONMENT + "/token";
    }

    @When("user sends a request to session API")
    public void user_sends_a_request_to_session_api()
            throws URISyntaxException, IOException, InterruptedException {
        LOG.info("DEV_SESSION_URI is --------" + devSessionUri);
        response = IpvCoreStubUtil.sendSessionRequest(devSessionUri, sessionRequestBody);
        responseBodyMap = objectMapper.readValue(response.body(), new TypeReference<>() {});
    }

    @Then("user gets a session id")
    public void user_gets_a_session_id() {
        assertEquals(201, response.statusCode());
        assertNotNull(responseBodyMap.get("session_id"));
        currentSessionId = responseBodyMap.get("session_id");
    }

    @When("user sends an empty request to session end point")
    public void user_sends_an_empty_request_to_session_end_point()
            throws URISyntaxException, IOException, InterruptedException {
        response = IpvCoreStubUtil.sendSessionRequest(devSessionUri, "");
        responseBodyMap = objectMapper.readValue(response.body(), new TypeReference<>() {});
    }

    @Then("expect a status code of {int} in the response")
    public void expect_status_code_in_response(int statusCode) {
        assertEquals(statusCode, response.statusCode());
    }

    @And("the request body has no {word}")
    public void remove_key(String key) throws IOException {
        Map<String, String> map =
                objectMapper.readValue(sessionRequestBody, new TypeReference<>() {});
        map.remove(key);
        sessionRequestBody = objectMapper.writeValueAsString(map);
    }

    @When("user sends a valid request to authorization end point")
    public void user_sends_a_valid_request_to_authorization_end_point()
            throws IOException, InterruptedException, URISyntaxException {
        LOG.info("DEV_AUTHORIZATION_URI is --------" + devAuthorizationUri);
        response =
                IpvCoreStubUtil.sendAuthorizationRequest(
                        devAuthorizationUri, currentSessionId, DEFAULT_CLIENT_ID);
    }

    @And("a valid authorization code is returned in the response")
    public void aValidAuthorizationCodeIsReturnedInTheResponse() throws IOException {
        JsonNode jsonNode = objectMapper.readTree(response.body());

        currentAuthorizationCode = jsonNode.get("authorizationCode").get("value").textValue();
        assertNotNull(currentAuthorizationCode);
        assertFalse(currentAuthorizationCode.isEmpty());
        assertDoesNotThrow(() -> Base64.getUrlDecoder().decode(currentAuthorizationCode));

        assertEquals(DEFAULT_REDIRECT_URI, jsonNode.get("redirectionURI").textValue());
        assertEquals("state-ipv", jsonNode.get("state").get("value").textValue());
    }

    @When("user sends a request to authorization end point with invalid client id")
    public void user_sends_a_request_to_authorization_end_point_with_invalid_client_id()
            throws URISyntaxException, IOException, InterruptedException {
        response =
                IpvCoreStubUtil.sendAuthorizationRequest(
                        devAuthorizationUri, currentSessionId, "INVALID-CLIENT-ID");
    }

    @When("user sends a request to authorization end point with invalid redirect uri")
    public void userSendsARequestToAuthorizationEndPointWithInvalidRedirectUri()
            throws URISyntaxException, IOException, InterruptedException {
        response =
                IpvCoreStubUtil.sendAuthorizationRequest(
                        devAuthorizationUri,
                        currentSessionId,
                        "https://wrong-incorrect-url/callback",
                        DEFAULT_CLIENT_ID);
    }

    @When("user sends a request to authorization end point with access_denied")
    public void userSendsARequestToAuthorizationEndPointWithAccessDenied()
            throws URISyntaxException, IOException, InterruptedException {
        response =
                IpvCoreStubUtil.sendAuthorizationRequest(
                        devAuthorizationUri, currentSessionId, DEFAULT_CLIENT_ID);
    }

    @When("user sends a request to access token end point")
    public void userSendsARequestToAccessTokenEndPoint()
            throws URISyntaxException, IOException, InterruptedException {
        response = IpvCoreStubUtil.sendAccessTokenRequest(currentAuthorizationCode);
    }

    @And("a valid access token is returned in the response")
    public void aValidAccessTokenIsReturnedInTheResponse() throws IOException {
        JsonNode jsonNode = objectMapper.readTree(response.body());
        assertNotNull(jsonNode.get("access_token").asText());
        assertEquals("Bearer", jsonNode.get("token_type").asText());
        assertEquals(3600, jsonNode.get("expires_in").asInt());
    }

    @And("a {string} error with code {int} is sent in the response")
    public void aErrorWithCodeIsSentInTheResponse(String errorMessage, int errorCode)
            throws IOException {
        JsonNode jsonNode = objectMapper.readTree(response.body());
        assertEquals(errorCode, jsonNode.get("code").asInt());
        assertEquals(errorMessage, jsonNode.get("message").asText());
        assertEquals(errorCode + ": " + errorMessage, jsonNode.get("errorSummary").asText());
    }

    @And("a {string} error with code {string} is sent in the response")
    public void aErrorIsSentInTheResponse(String errorMessage, String errorCode)
            throws IOException {
        JsonNode jsonNode = objectMapper.readTree(response.body());
        assertEquals(errorCode, jsonNode.get("code").asText());
        assertEquals(errorMessage, jsonNode.get("message").asText());
    }

    @When("user sends a request to access token end point with incorrect authorization code")
    public void userSendsARequestToAccessTokenEndPointWithIncorrectAuthorizationCode()
            throws URISyntaxException, IOException, InterruptedException {
        response = IpvCoreStubUtil.sendAccessTokenRequest("wrong_authorization_code");
    }

    @When("session has an authCode")
    public void sessionHasAnAuthCode()
            throws URISyntaxException, IOException, InterruptedException {
        response = sendCreateAuthCodeRequest(currentSessionId);
    }

    @Given("IPV authorization JAR for test user {int}")
    public void setIpvAuthorizationJARForTestUser(int rowNumber) throws Exception {
        setIpvAuthorizationJAR(rowNumber, A_VTR, A_STORAGE_ACCESS_TOKEN);
    }

    @Given("IPV authorization JAR for test user {int} with vtr {string}")
    public void setIpvAuthorizationJARWithVtr(int rowNumber, String vtr) throws Exception {
        setIpvAuthorizationJAR(rowNumber, List.of(vtr), A_STORAGE_ACCESS_TOKEN);
    }

    @Given("IPV authorization JAR for test user {int} with storage access token {string}")
    public void setIpvAuthorizationJARWithToken(int rowNumber, String token) throws Exception {
        setIpvAuthorizationJAR(rowNumber, A_VTR, token);
    }

    private void setIpvAuthorizationJAR(int rowNumber, List<String> vtr, String storageAccessToken)
            throws URISyntaxException, IOException, InterruptedException {
        Map<String, Object> claimsSet =
                objectMapper.readValue(
                        IpvCoreStubUtil.getClaimsForUser(rowNumber), new TypeReference<>() {});
        claimsSet.put("vtr", vtr);
        claimsSet.put(
                "claims",
                Map.of(
                        "userinfo",
                        Map.of(
                                STORAGE_ACCESS_TOKEN_CLAIM,
                                Map.of("values", List.of(storageAccessToken)))));

        sessionRequestBody =
                IpvCoreStubUtil.sendCreateSessionRequest(
                        objectMapper.writeValueAsString(claimsSet));
    }

    @Then("the session has the IPV claims")
    public void theSessionHasTheIpvClaims() {
        Map<String, AttributeValue> session =
                DynamoDBUtil.getSession(sessionTableName(), currentSessionId);

        assertEquals(A_VTR, session.get("vtr").l().stream().map(AttributeValue::s).toList());
        assertEquals(A_STORAGE_ACCESS_TOKEN, session.get("storageAccessToken").s());
    }

    @Then("the session request outcome matches the stack's authorization request type")
    public void theOutcomeMatchesTheAuthorizationRequestType() throws IOException {
        if (IPV_CLAIMS_REQUIRED) {
            assertEquals(400, response.statusCode());
            aErrorWithCodeIsSentInTheResponse("Session Validation Exception", 1019);
            return;
        }

        user_gets_a_session_id();

        Map<String, AttributeValue> session =
                DynamoDBUtil.getSession(sessionTableName(), currentSessionId);
        assertFalse(session.containsKey("vtr"));
        assertFalse(session.containsKey("storageAccessToken"));
    }

    private static String sessionTableName() {
        return OAUTH_TABLES ? SESSION_TABLE_NAME : "session-common-cri-api";
    }

    private static String aSignedJwt() {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();

        return encoder.encodeToString(
                        "{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8))
                + "."
                + encoder.encodeToString(
                        "{\"sub\":\"urn:uuid:abc\"}".getBytes(StandardCharsets.UTF_8))
                + ".a-signature";
    }

    @When("the session data is in the correct tables")
     public void sessionDataIsInTheCorrectTables() {
        if(OAUTH_TABLES) {
            assertTrue(DynamoDBUtil.sessionExists(SESSION_TABLE_NAME, currentSessionId));
            assertTrue(DynamoDBUtil.sessionExists(PERSON_IDENTITY_TABLE_NAME, currentSessionId));
        } else {
            assertFalse(DynamoDBUtil.sessionExists(SESSION_TABLE_NAME, currentSessionId));
            assertFalse(DynamoDBUtil.sessionExists(PERSON_IDENTITY_TABLE_NAME, currentSessionId));
        }

        if(COMMON_LAMBDAS_TABLES) {
            assertTrue(DynamoDBUtil.sessionExists("session-common-cri-api", currentSessionId));
            assertTrue(DynamoDBUtil.sessionExists("person-identity-common-cri-api", currentSessionId));
        } else {
            assertFalse(DynamoDBUtil.sessionExists("session-common-cri-api", currentSessionId));
            assertFalse(DynamoDBUtil.sessionExists("person-identity-common-cri-api", currentSessionId));
        }
    }

    @When("I create a new session update request")
    public void iCreateANewSessionUpdateRequest() {
        sessionUpdateRequestBodyMap = new HashMap<>();
    }

    @And("The session update request contains the field {string} set to {string}")
    public void theSessionUpdateRequestContainsTheFieldSetTo(String name, String value) {
        if (value.equals("null")) {
            sessionUpdateRequestBodyMap.put(name, null);
        } else {
            sessionUpdateRequestBodyMap.put(name, value);
        }
    }

    @And("I send the session update request")
    public void iSendTheSessionUpdateRequest() throws IOException, URISyntaxException, InterruptedException {
        sessionUpdateRequestBody = objectMapper.writeValueAsString(sessionUpdateRequestBodyMap);
        response = IpvCoreStubUtil.sendUpdateSessionRequest(devSessionUri, currentSessionId, sessionUpdateRequestBody);
    }

    @When("I retrieve session information")
    public void iRetrieveSessionInformation() throws URISyntaxException, IOException, InterruptedException {
        response = IpvCoreStubUtil.sendGetSessionRequest(devSessionUri, currentSessionId);
    }

    @And("The session should contain {int} fields")
    public void theSessionShouldContainFields(int size) throws IOException {
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), new TypeReference<Map<String, Object>>() {});
        assertNotNull(responseBody);
        assertEquals(size, responseBody.size());
    }

    @And("The session should contain a {string} object with {int} fields")
    public void theSessionShouldContainAnObjectWithFields(String objectKey, int size) throws IOException {
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), new TypeReference<Map<String, Object>>() {});
        assertTrue(responseBody.containsKey(objectKey));
        @SuppressWarnings("unchecked")
        Map<String, Object> nestedObject = (Map<String, Object>) responseBody.get(objectKey);
        assertNotNull(nestedObject);
        assertEquals(size, nestedObject.size());
    }

    @And("The session {string} should contain the field {string} with the value {string}")
    public void theSessionNestedObjectShouldContainTheFieldWithTheValue(String objectKey, String field, String value) throws IOException {
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), new TypeReference<Map<String, Object>>() {});
        @SuppressWarnings("unchecked")
        Map<String, Object> nestedObject = (Map<String, Object>) responseBody.get(objectKey);
        assertNotNull(nestedObject);
        assertTrue(nestedObject.containsKey(field));
        assertEquals(value, nestedObject.get(field));
    }

    @And("The session should not contain the field {string}")
    public void theSessionShouldNotContainTheField(String field) throws IOException {
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), new TypeReference<Map<String, Object>>() {});
        assertFalse(responseBody.containsKey(field));
    }

    @And("The session should contain the field {string}")
    public void theSessionShouldContainTheField(String field) throws IOException {
        Map<String, Object> responseBody = objectMapper.readValue(response.body(), new TypeReference<Map<String, Object>>() {});
        assertTrue(responseBody.containsKey(field));
    }
}
