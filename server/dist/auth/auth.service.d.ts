export interface LoginResult {
    openid: string;
    session_key?: string;
}
export declare class AuthService {
    code2Openid(code: string): Promise<LoginResult>;
}
