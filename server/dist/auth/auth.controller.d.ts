import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(body: {
        code: string;
    }): Promise<import("./auth.service").LoginResult>;
}
