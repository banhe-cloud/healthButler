"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const child_process_1 = require("child_process");
async function freePort(port) {
    try {
        (0, child_process_1.execSync)(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, {
            stdio: 'ignore',
            shell: '/bin/zsh',
        });
        await new Promise((r) => setTimeout(r, 300));
    }
    catch {
    }
}
async function bootstrap() {
    const port = parseInt(process.env.PORT ?? '3000', 10);
    await freePort(port);
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });
    await app.listen(port);
    console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map