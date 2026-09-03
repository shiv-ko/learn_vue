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
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

export class TodoAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "TodosTable", {
      tableName: "Todos",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const bookmarksTable = new dynamodb.Table(this, "BookmarksTable", {
      tableName: "Bookmarks",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const metadataDeadLetterQueue = new sqs.Queue(this, "BookmarkMetadataDeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const metadataQueue = new sqs.Queue(this, "BookmarkMetadataQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: metadataDeadLetterQueue,
        maxReceiveCount: 5,
      },
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

    const bookmarksApiFn = new nodejs.NodejsFunction(this, "BookmarksApiFunction", {
      entry: path.join(__dirname, "../src/bookmarks-api/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        BOOKMARKS_TABLE_NAME: bookmarksTable.tableName,
        BOOKMARK_METADATA_QUEUE_URL: metadataQueue.queueUrl,
      },
    });
    bookmarksTable.grantReadWriteData(bookmarksApiFn);
    metadataQueue.grantSendMessages(bookmarksApiFn);

    const bookmarkMetadataFn = new nodejs.NodejsFunction(this, "BookmarkMetadataFunction", {
      entry: path.join(__dirname, "../src/bookmark-metadata/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(45),
      memorySize: 256,
      environment: { BOOKMARKS_TABLE_NAME: bookmarksTable.tableName },
    });
    bookmarksTable.grantReadWriteData(bookmarkMetadataFn);
    bookmarkMetadataFn.addEventSource(
      new lambdaEventSources.SqsEventSource(metadataQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    const lineWebhookFn = new nodejs.NodejsFunction(this, "LineWebhookFunction", {
      entry: path.join(__dirname, "../src/line-webhook/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TODOS_TABLE_NAME: table.tableName,
        BOOKMARKS_TABLE_NAME: bookmarksTable.tableName,
        BOOKMARK_METADATA_QUEUE_URL: metadataQueue.queueUrl,
        LINE_CHANNEL_SECRET: lineChannelSecret,
      },
    });
    table.grantReadWriteData(lineWebhookFn);
    bookmarksTable.grantReadWriteData(lineWebhookFn);
    metadataQueue.grantSendMessages(lineWebhookFn);

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

    const androidUserPoolClient = userPool.addClient("TodoAppAndroidClient", {
      userPoolClientName: "todo-app-android",
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["todobookmark://callback"],
        logoutUrls: ["todobookmark://signout"],
      },
      idTokenValidity: cdk.Duration.minutes(60),
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    const userPoolDomain = userPool.addDomain("TodoAppHostedUiDomain", {
      cognitoDomain: {
        domainPrefix: `todo-app-${cdk.Aws.ACCOUNT_ID}`,
      },
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

    const bookmarksResource = api.root.addResource("bookmarks");
    bookmarksResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(bookmarksApiFn),
      authenticatedMethodOptions,
    );
    bookmarksResource
      .addResource("batch")
      .addMethod(
        "POST",
        new apigateway.LambdaIntegration(bookmarksApiFn),
        authenticatedMethodOptions,
      );
    const bookmarkIdResource = bookmarksResource.addResource("{id}");
    bookmarkIdResource.addMethod(
      "PATCH",
      new apigateway.LambdaIntegration(bookmarksApiFn),
      authenticatedMethodOptions,
    );
    bookmarkIdResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(bookmarksApiFn),
      authenticatedMethodOptions,
    );

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
          bookmarks: apiBehavior,
          "bookmarks/*": apiBehavior,
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
    new cdk.CfnOutput(this, "AndroidUserPoolClientId", {
      value: androidUserPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "HostedUiDomain", {
      value: userPoolDomain.baseUrl(),
    });
    new cdk.CfnOutput(this, "Region", { value: cdk.Aws.REGION });
    new cdk.CfnOutput(this, "AndroidCallbackUrl", {
      value: "todobookmark://callback",
    });
    new cdk.CfnOutput(this, "AppUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
