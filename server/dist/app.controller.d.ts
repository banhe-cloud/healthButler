import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';
export declare class AppController {
    private readonly appService;
    private readonly db;
    constructor(appService: AppService, db: DatabaseService);
    getHello(): string;
    debugDb(): Promise<{
        count: number;
        sample: import("./database/database.service").ChatRecord[];
    }>;
    debugEnv(): {
        hasKey: boolean;
        keyPrefix: string | null;
        model: string | undefined;
    };
}
