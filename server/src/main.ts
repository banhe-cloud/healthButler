import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { execSync } from 'child_process';

async function freePort(port: number) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, {
      stdio: 'ignore',
      shell: '/bin/zsh',
    });
    await new Promise((r) => setTimeout(r, 300));
  } catch {
    // 端口本来就没被占用，忽略
  }
}

async function bootstrap() {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await freePort(port);

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
