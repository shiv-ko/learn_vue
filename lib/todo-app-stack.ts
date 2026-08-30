import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

export class TodoAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "TodosTable", {
      tableName: "Todos",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const lineChannelSecret = ssm.StringParameter.valueForStringParameter(
      this,
      "/todo-app/line-channel-secret",
    );

    const todosApiFn = new nodejs.NodejsFunction(this, "TodosApiFunction", {
      entry: path.join(__dirname, "../src/todos-api/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      environment: { TODOS_TABLE_NAME: table.tableName },
    });
    table.grantReadWriteData(todosApiFn);

    const lineWebhookFn = new nodejs.NodejsFunction(this, "LineWebhookFunction", {
      entry: path.join(__dirname, "../src/line-webhook/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      environment: {
        TODOS_TABLE_NAME: table.tableName,
        LINE_CHANNEL_SECRET: lineChannelSecret,
      },
    });
    table.grantReadWriteData(lineWebhookFn);

    const api = new apigateway.RestApi(this, "TodoApi", {
      restApiName: "todo-app-api",
    });

    const userPool = new cognito.UserPool(this, "TodoAppUserPool", {
      userPoolName: "todo-app-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("TodoAppSpaClient", {
      userPoolClientName: "todo-app-spa",
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "TodoAppAuthorizer",
      {
        cognitoUserPools: [userPool],
        identitySource: "method.request.header.Authorization",
      },
    );

    const authenticatedMethodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    };

    const todosResource = api.root.addResource("todos");
    todosResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(todosApiFn),
      authenticatedMethodOptions,
    );
    todosResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(todosApiFn),
      authenticatedMethodOptions,
    );

    const todoIdResource = todosResource.addResource("{id}");
    todoIdResource.addMethod(
      "PATCH",
      new apigateway.LambdaIntegration(todosApiFn),
      authenticatedMethodOptions,
    );
    todoIdResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(todosApiFn),
      authenticatedMethodOptions,
    );

    const lineResource = api.root.addResource("line").addResource("webhook");
    lineResource.addMethod("POST", new apigateway.LambdaIntegration(lineWebhookFn));

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "FrontendSecurityHeaders",
      {
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://cognito-idp.ap-northeast-3.amazonaws.com",
              "img-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join("; "),
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
        },
      },
    );

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.RestApiOrigin(api),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: securityHeadersPolicy,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
    };

    const distribution = new cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        defaultRootObject: "index.html",
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
        },
        additionalBehaviors: {
          todos: apiBehavior,
          "todos/*": apiBehavior,
        },
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      },
    );

    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../frontend/dist"))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ["/*"],
      prune: true,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "AppUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
