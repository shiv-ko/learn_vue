import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TodoAppStack } from "../../lib/todo-app-stack";

describe("TodoAppStack", () => {
  it("creates the backend resources and protects CRUD methods with Cognito", () => {
    const app = new App();
    const stack = new TodoAppStack(app, "TestTodoAppStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    template.resourceCountIs("AWS::ApiGateway::Authorizer", 1);
    template.resourceCountIs("AWS::ApiGateway::ApiKey", 0);
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.resourceCountIs("Custom::CDKBucketDeployment", 1);

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    });

    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UsernameAttributes: ["email"],
    });

    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlowsUserPoolClient: false,
      GenerateSecret: false,
      ExplicitAuthFlows: [
        "ALLOW_USER_PASSWORD_AUTH",
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
      ],
    });

    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      AuthorizationType: "COGNITO_USER_POOLS",
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "POST",
      AuthorizationType: "COGNITO_USER_POOLS",
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "PATCH",
      AuthorizationType: "COGNITO_USER_POOLS",
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "DELETE",
      AuthorizationType: "COGNITO_USER_POOLS",
    });

    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        Enabled: true,
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: "todos" }),
          Match.objectLike({ PathPattern: "todos/*" }),
        ]),
      }),
    });
  });
});
