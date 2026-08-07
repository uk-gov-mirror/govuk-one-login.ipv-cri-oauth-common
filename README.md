# di-ipv-cri-oauth-common: DI IPV Credential Issuer OAuthCommon Stack

This repository is the home for a shared stack containing resources that handle the OAuth relationship with IPV Core.

This is the replacement for [common-lambdas](https://github.com/govuk-one-login/ipv-cri-common-lambdas)

## Documentation

Detailed documentation is available in the docs directory:

- [Parameters](docs/parameters.md) – Complete reference for all CloudFormation/SAR parameters, including descriptions, defaults, and valid values.
- [Outputs](docs/outputs.md) – Description of all CloudFormation stack outputs and how they can be used.
- [Integration tests](docs/integration-tests.md) - Guidance on running integration tests locally
- [Localdev testing](docs/localdev.md) - A guide on testing with localdev CRI stacks
- [CommonLambdas migration](docs/migration.md) - A guide on migirating to OAuthCommon from CommonLambdas

Further information can also be found [in Confluence](https://govukverify.atlassian.net/wiki/spaces/OJ/pages/6428000475/).

## Known Issue

### Overview

If you change any of the stack parameters that have a knock-on effect to the Lambda functions, for example, changing a value in their environment variables. It updates the $Latest version of the Lambda correctly BUT does not publish a new version. As a result, the live alias remains pointing at the only version (1) and has no effect on running code.

### Impacted CF Parameters;
- `AuditEventNamePrefix`
- `AuditTxmaStackName`
- `AuthorizationRequestType`
- `CommonLambdasStackName`
- `CommonLambdasUsesCMK`
- `CriIdentifier`
- `CriAudience`
- `CriVcIssuer`
- `KeyRotation`
- `KeyRotationFallback`

### Current Workaround

If you want to change any of the above parameters, follow the below.

1. First publish a new version of OAuthCommon, this can contain no actual changes other than the SAR version. 
2. Combine changing the OAuthCommon CF parameter(s) within the same merge/deploy as bumping to your new published version.

More information/investigation [here](https://govukverify.atlassian.net/browse/OJ-3834)

## Hooks

### Pre-commit

**important:** One you've cloned the repo, run `pre-commit install` to install the pre-commit hooks.
If you have not installed `pre-commit` then please do so [here](https://pre-commit.com/).

### Check repo for secrets

Run `detect-secrets scan --baseline .secrets.baseline` to check for potential leaked secrets.

Use the keyword and secret exclusion lists in the baseline file to prevent the utility from flagging up specific strings.
