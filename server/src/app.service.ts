import { Injectable } from '@nestjs/common';
import cloudbaseSDK from "@cloudbase/node-sdk";
import dotenv from "dotenv";
dotenv.config();

@Injectable()
export class AppService {
  private cloudbase = cloudbaseSDK.init({
    env: process.env.CLOUDBASE_ENV_ID,
    secretId: process.env.CLOUDBASE_SECRET_ID,
    secretKey: process.env.CLOUDBASE_SECRET_KEY,
  });

  getCloudbase() {
    return this.cloudbase;
  }

  getHello(): any {
    return this.cloudbase;
  }
}
