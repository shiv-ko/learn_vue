import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { appConfig } from "./config";

const userPool = new CognitoUserPool({
  UserPoolId: appConfig.userPoolId,
  ClientId: appConfig.userPoolClientId,
});

export class NewPasswordRequiredError extends Error {
  constructor() {
    super("初回パスワードの変更が必要です。先にAWS CLIまたはConsoleで恒久パスワードを設定してください。");
    this.name = "NewPasswordRequiredError";
  }
}

export function signIn(email: string, password: string): Promise<string> {
  const user = new CognitoUser({ Username: email.trim(), Pool: userPool });
  const details = new AuthenticationDetails({
    Username: email.trim(),
    Password: password,
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (error) => reject(error),
      newPasswordRequired: () => reject(new NewPasswordRequiredError()),
    });
  });
}

export function getCurrentToken(): Promise<string | null> {
  const user = userPool.getCurrentUser();
  if (!user) return Promise.resolve(null);

  return new Promise((resolve) => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function signOut(): void {
  userPool.getCurrentUser()?.signOut();
}

