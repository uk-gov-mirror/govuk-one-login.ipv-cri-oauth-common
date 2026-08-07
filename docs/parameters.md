## Stack Parameters

> **Note:** All example values are taken from the `ipv-cri-check-hmrc-api` dev environment.

| Parameter | Required | Default               | Description                                                                    | Example |
|----------|----------|-----------------------|--------------------------------------------------------------------------------|---------|
| AuditEventNamePrefix | Yes      | -                     | The audit event name prefix                                                    | `IPV_HMRC_RECORD_CHECK_CRI` |
| AuditTxmaStackName | No       | `txma-infrastructure` | The stack containing the TXMA infrastructure                                   | `txma-infrastructure` |
| AuthorizationRequestType | No | `CRI` | Whether the stack serves `CRI` or `IPV` authorisation requests | `IPV` |
| BuildNotificationStackName | No       | `build-notifications` | The stack containing the topic to publish notification and sns alerts          | `build-notifications` |
| CommonLambdasStackName | No | `""` | For migration only - Existing common-lambdas stack name, to allow the use common-lambdas tables during a migration. | `common-cri-api` |
| CommonLambdasUsesCMK | No | `false` |  For migration only - Does the common-lambdas stack in the account use a CMK for its databases. | `true` |
| CSLSDestinationArn | No       | `none`                | ARN of the CSLSEGRESS destination                                              | `arn:aws:logs:eu-west-2:885513274347:destination:csls_cw_logs_destination_prodpython-2` |
| CriIdentifier | Yes      | -                     | The unique credential issuer identifier                                        | `di-ipv-cri-check-hmrc-api` |
| CriAudience | Yes      | -                     | Audience for the CRI                                                           | `https://review-hc.dev.account.gov.uk` |
| CriVcIssuer | Yes      | -                     | Issuer for the CRI                                                             | `https://review-hc.dev.account.gov.uk` |
| CriPrivateApiGwName | Yes      | -                     | The private API GW name, for Canary alarms                                     | `check-hmrc-cri-api-private` |
| CriPublicApiGwName | Yes      | -                     | The public API GW name, for Canary alarms                                      | `check-hmrc-cri-api-public` |
| CriPrivateApiGatewayID | Yes      | `*`                   | The private api gateway in the account that can invoke the lambda              | `pwb525k4q8` |
| CriPublicApiGatewayID | Yes      | `*`                   | The public api gateway in the account that can invoke the lambda               | `o32badl97j` |
| DbSessionTTL | No       | 7200                  | TTL for the Session Table, default 2 hours                                     | 7200 |
| DbCustomerManagedKey | No       | `true`                | Use a CustomerManagedKey for the DynamoDB Tables                               | `false` |
| DefaultClientId | No       | `ipv-core`            | The client ID used by the main OAuth client                                    | `ipv-core` |
| Environment | Yes      | -                     | The deployed environment                                                       | `dev` |
| IPVCoreRedirectURI | Yes      | -                     | Redirect URL to IPV CORE                                                       | `dev` |
| IsCredentialIssuer | No       | `true`                | Whether or not the OAuth protected resource is a signed credential             | `true` |
| IPVCoreStubJwksEndpoint | No       | `""` (empty string)   | Stubbed JWKS endpoint for non-prod environments                                | `https://test-resources.review-hc.dev.account.gov.uk/.well-known/jwks.json` |
| KeyRotation | No       | `true`                | Feature flag for ENV_VAR_FEATURE_FLAG_KEY_ROTATION                             | `false` |
| KeyRotationFallback | No       | `false`               | Feature flag for ENV_VAR_FEATURE_FLAG_KEY_ROTATION_LEGACY_KEY_FALLBACK         | `true` |
| LambdaCodeSigningConfigArn | No       | `none`                | The ARN of the Code Signing Config to use, provided by the deployment pipeline | `An AWS ARN` |
| LambdaDeploymentPreference | No       | `AllAtOnce`           | Stubbed JWKS endpoint for non-prod environments                                | `AllAtOnce` |
| LambdaProvisionedConcurrentExecutions | No       | 0                     | Stubbed JWKS endpoint for non-prod environments                                | 1 |
| LambdaVpcConfiguration | Yes      | -                     | Stubbed JWKS endpoint for non-prod environments                                | `di-devplatform-deploy` |
| PermissionsBoundaryArn | No       | `none`                | The ARN of the permissions boundary to apply when creating IAM roles           | `An AWS ARN` |
| VpcStackNameOverride | No       | `cri-vpc`             | The name of the stack containing VPC infrastructure                            | `cri-vpc` |

> **Note:** The `VpcStackNameOverride` parameter will be renamed to `VpcStackName`
in line with a similar parameter set on the pipeline. However, some of the pipelines currently set `VpcStackName` to
`None`, which is not a valid value for the parameter in the template. This parameter will be renamed once the
pipelines are updated to set the `VpcStackName` explicitly, or not at all (thus relying on the default value in the
template).