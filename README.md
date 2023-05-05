# aws-express-dynamodb-local-api 開發環境

此教學是用來建立 AWS 的 Node.js express 搭配 Docker 版 dynamodb 的 local API 離線開發環境。

## 前言

AWS Lambda 有兩種開發風格，一種是 serverless framework 自己的寫法，一種是 AWS SAM 風格的寫法 [^1] ，開發難易度方面 AWS SAM 較為簡單，但是 serverless framework 寫法比較能開發複雜的應用。雖然在 serverless framework 中兩種寫法都支援，但若要讓 serverless framework 能夠支援三大主流雲端平台 AWS、GCP、Azure 的話，則不能採用 SAM 的寫法，必須使用 serverless framework 的寫法。因此我們將採用 serverless framework 寫法來建立無服務的基本架構。

|          | SAM 模式             | serverless      |
| -------- | -------------------- | --------------- |
| 開發工具 | AWS Web / serverless | serverless      |
| 開發難度 | 簡單                 | 困難            |
| 應用場景 | 簡單                 | 複雜            |
| 支援平台 | AWS                  | AWS、GCP、Azure |

## 使用 templete 建立環境

首先全域安裝 `serverless` 套件，建專案要用到。

```bash
npm install -g serverless
```

serverless 官方提供了許多範例 [^2] 來快速建立開發環境，可以透過樣板 URL 來建立 CRUD 範例，這裡我們使用 `aws-node-express-dynamodb-api` 作為樣板來修改，其中 `aws-express-dynamodb-local-api` 專案名稱可自行修改。

```bash
serverless --name aws-express-dynamodb-local-api --template-url=https://github.com/serverless/examples/tree/v3/aws-node-express-dynamodb-api
```

執行過程中選擇 No 不要部署，結果如下：

```bash
❯ serverless --name aws-express-dynamodb-local-api --template-url=https://github.com/serverless/examples/tree/v3/aws-node-express-dynamodb-api

Creating a new serverless project


✔ Project successfully created in aws-express-dynamodb-local-api folder

? Do you want to deploy now? No

What next?
Run these commands in the project directory:

serverless deploy    Deploy changes
serverless info      View deployed endpoints and resources
serverless invoke    Invoke deployed functions
serverless --help    Discover more commands
```

## 建立 DynamoDBLocal 資料庫

目前網路上的教學大部分都是使用 `serverless-dynamodb-local` 套件建立 Local 版本的 DynamoDB，但是在 npm 上 可以看到套件已經被棄用，因此需要改使用 AWS 官方的 DynamoDBLocal [^3] 來啟動資料庫服務，並且自行手動建立資料庫、資料表、欄位等配置。

首先我們使用 Docker 來建立開發用的資料庫環境，需要新增一個`docker-compose.yml` 檔案內容如下：

**docker-compose.yml**
```yaml
version: '3.8'
services:
  dynamodb-local:
    command: "-jar DynamoDBLocal.jar -sharedDb -dbPath ./data"
    image: "amazon/dynamodb-local:latest"
    container_name: dynamodb-local
    ports:
      - "8000:8000"
    volumes:
      - "./docker/dynamodb:/home/dynamodblocal/data"
    working_dir: /home/dynamodblocal
```

然後執行 `docker-compose up -d` 指令來建立並啟動 DynamoDBLocal ，結果如下：

```bash
❯ docker-compose up -d
[+] Running 2/2
 - Network aws-express-dynamodb-local-api_default  Created  0.1s
 - Container dynamodb-local                        Started  1.4s
```

### 使用 JS 程式自動建立 Table

首先安裝範例程式需要的 `js-yaml` 套件：

```bash
npm install js-yaml
```

參考開源 gist [^4] 建立一支程式用來自動化建表。

**create-tables-local.js**
```javascript
const fs = require('fs');
const {
  DynamoDBClient,
  ListTablesCommand,
  CreateTableCommand
} = require("@aws-sdk/client-dynamodb");
const yaml = require('js-yaml');
const cloudformationSchema = require('@serverless/utils/cloudformation-schema');

const SERVERLESS_CONFIG = __dirname + '/serverless.yml';

const client = new DynamoDBClient({
  region: 'local',
  endpoint: 'http://localhost:8000',
});

async function getDynamoDBTableResources() {
  const tables = Object.entries(
    yaml.loadAll(fs.readFileSync(SERVERLESS_CONFIG), {
      schema: cloudformationSchema,
    })[0].resources.Resources,
  ).filter(
    ([, resource]) =>
      resource.Type === 'AWS::DynamoDB::Table',
  );

  return tables;
}

(async function main() {
  console.info('Setting up local DynamoDB tables');

  const tables = await getDynamoDBTableResources();
  const existingTables = (await client.send(new ListTablesCommand())).TableNames;

  for await ([logicalId, definition] of tables) {
    const {
      Properties: {
        BillingMode,
        TableName,
        AttributeDefinitions,
        KeySchema,
        GlobalSecondaryIndexes,
        LocalSecondaryIndexes,
      },
    } = definition;

    if (
      existingTables.find((table) => table === TableName)
    ) {
      console.info(`${logicalId}: DynamoDB Local - Table already exists: ${TableName}. Skipping..`);
      continue;
    }

    const input = {
      AttributeDefinitions,
      BillingMode,
      KeySchema,
      LocalSecondaryIndexes,
      GlobalSecondaryIndexes,
      TableName,
    };

    const result = await client.send(new CreateTableCommand(input));

    console.info(`${logicalId}: DynamoDB Local - Created table: ${TableName}`);
  }
})();
```

執行腳本 `node .\create-tables-local.js` 來建表。

```bash
❯ node .\create-tables-local.js
Setting up local DynamoDB tables
UsersTable: DynamoDB Local - Created table: users
```

## 建立 CRUD 程式

首先安裝範例程式需要的 `@aws-sdk/client-dynamodb` [^5] 、 `@aws-sdk/lib-dynamodb` [^6] 等套件：

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb uuid
```

**package.json**
```json
{
  "name": "aws-express-dynamodb-local-api",
  "version": "1.0.0",
  "description": "",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.316.0",
    "@aws-sdk/lib-dynamodb": "^3.316.0",
    "express": "^4.18.2",
    "serverless-http": "^3.2.0",
    "uuid": "^9.0.0"
  }
}
```

將以下範例程式覆蓋原本的 `index.js` 。

**index.js**
```javascript
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const express = require("express");
const serverless = require("serverless-http");
const { v4: uuid } = require('uuid');

const app = express();

const USERS_TABLE = process.env.USERS_TABLE;

let options = {};

if (process.env.IS_OFFLINE) {
  options = {
    region: 'localhost',
    endpoint: 'http://localhost:8000',
  };
}

const client = new DynamoDBClient(options);
const dynamoDbClient = DynamoDBDocumentClient.from(client);

app.use(express.json());

app.post("/users", async function (req, res) {
  const { name } = req.body;
  if (typeof name !== "string") {
    res.status(400).json({ error: '"name" must be a string' });
  }

  const userId = uuid();

  const params = {
    TableName: USERS_TABLE,
    Item: {
      userId,
      name,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({ userId, name });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not create user" });
  }
});

app.get("/users/:userId", async function (req, res) {
  const params = {
    TableName: USERS_TABLE,
    Key: {
      userId: req.params.userId,
    },
  };

  try {
    const { Item } = await dynamoDbClient.send(new GetCommand(params));
    if (Item) {
      const { userId, name } = Item;
      res.json({ userId, name });
    } else {
      res
        .status(404)
        .json({ error: 'Could not find user with provided "userId"' });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not retreive user" });
  }
});

app.get("/users", async function (req, res) {
  try {
    const params = {
      TableName: USERS_TABLE,
    };
    const { Items, Count } = await dynamoDbClient.send(new ScanCommand(params));
    res.json({ Items, Count });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not retreive user" });
  }
});

app.put("/users/:userId", async function (req, res) {

  const { userId } = req.params;
  const { name } = req.body;

  const params = {
    TableName: USERS_TABLE,
    Item: {
      userId,
      name,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({ userId, name });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not retreive user" });
  }
});

app.delete("/users/:userId", async function (req, res) {

  const { userId } = req.params;

  const params = {
    TableName: USERS_TABLE,
    Key: {
      userId,
    },
  };

  try {
    await dynamoDbClient.send(new DeleteCommand(params));
    res.json({ userId });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not retreive user" });
  }
});

module.exports.handler = serverless(app);
```

## 配置 serverless-offline

安裝 `serverless-offline` 套件，它可以讓我們在離線環境下啟動 Lambda function 服務。

```bash
npm install serverless-offline --save-dev
```

修改 `serverless.yml` 設定，加入離線開發套件，然後 API 的部分可以先設定為 `*` 號來匹配所有路由，然後設定 dynamodb 的相關功能。

> 注意，本範例教學的地區為 `ap-northeast-1` (東京) ，後續清除教學中的路徑都是以東京為例。

**serverless.yml**
```yaml
service: aws-express-dynamodb-local-api
frameworkVersion: '3'

custom:
  tableName: 'users-table-${sls:stage}'

provider:
  name: aws
  region: ap-northeast-1
  runtime: nodejs18.x
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
          Resource:
            - Fn::GetAtt: [ UsersTable, Arn ]
  environment:
    USERS_TABLE: ${self:custom.tableName}

plugins:
  - serverless-offline

functions:
  api:
    handler: index.handler
    events:
      - httpApi: '*'

resources:
  Resources:
    UsersTable:
      Type: AWS::DynamoDB::Table
      Properties:
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
        BillingMode: PAY_PER_REQUEST
        TableName: ${self:custom.tableName}
```

輸入 `serverless offline` 指令離線執行程式

```bash
❯ serverless offline
Running "serverless" from node_modules

Starting Offline at stage dev (ap-northeast-1)

Offline [http for lambda] listening on http://localhost:3002
Function names exposed for local invocation by aws-sdk:
           * api: aws-express-dynamodb-local-api-dev-api

   ┌───────────────────────────────────────────────────────────────────────┐
   │                                                                       │
   │   ANY | http://localhost:3000/{default*}                              │
   │   POST | http://localhost:3000/2015-03-31/functions/api/invocations   │
   │                                                                       │
   └───────────────────────────────────────────────────────────────────────┘

Server ready: http://localhost:3000 🚀
```

到這裡已經建立好離線開發環境，可以在 Local 環境送請求到 API 來測試。

![](https://i.imgur.com/pctOiK3.png)

## 上線部署

部署前請先設定好 AWS 憑證，可參考 AWS CLI 的命名設定檔 [^7] 教學。

執行 `serverless deploy` 就會自動幫你部署到 AWS 雲端。

```bash
❯ serverless deploy
Running "serverless" from node_modules

Deploying aws-express-dynamodb-local-api to stage dev (ap-northeast-1)

✔ Service deployed to stack aws-express-dynamodb-local-api-dev (141s)

endpoint: ANY - https://50hvx7ge4m.execute-api.ap-northeast-1.amazonaws.com

functions:
  api: aws-express-dynamodb-local-api-dev-api (3.6 MB)

Improve API performance – monitor it with the Serverless Console: run "serverless --console"
```

部署成功後，你會在訊息中得到一個 API 路徑像是：

```
https://50hvx7ge4m.execute-api.ap-northeast-1.amazonaws.com
```

可以透過 `https://50hvx7ge4m.execute-api.ap-northeast-1.amazonaws.com/users` 路徑 POST 新增一筆資料：

```json
{
    "userId": "d32c8caf-8563-44a1-9dab-dd36ee5f5ac7",
    "name": "QQBoxy"
}
```

也可以 GET 取得清單：

```json
{
  "Items": [
    {
      "name": "QQBoxy",
      "userId": "d32c8caf-8563-44a1-9dab-dd36ee5f5ac7"
    }
  ],
  "Count": 1
}
```

結果如圖所示：

![](https://i.imgur.com/Neomg6I.png)

## 清除資料

這裡參考 AWS 教學課程的步驟 8 [^1] ，需要刪除的資源如下：

* 刪除 DynamoDB 資料表
    * https://ap-northeast-1.console.aws.amazon.com/dynamodbv2/home?region=ap-northeast-1#tables
* 刪除 HTTP API
    * https://ap-northeast-1.console.aws.amazon.com/apigateway/main/apis?region=ap-northeast-1
* 刪除 Lambda 函數
    * https://ap-northeast-1.console.aws.amazon.com/lambda/home?region=ap-northeast-1#/functions
* 刪除 Lambda 函數的日誌群組
    * https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#logsV2:log-groups
* 刪除 Lambda 函數的執行角色
    * https://us-east-1.console.aws.amazon.com/iamv2/home#/roles

如果仍有問題，可以嘗試刪除以下資料

* 刪除 Amazon S3 儲存貯體
    * https://ap-northeast-1.console.aws.amazon.com/s3/buckets?region=ap-northeast-1
* 刪除 CloudFormation 堆疊
    * https://ap-northeast-1.console.aws.amazon.com/cloudformation/home?region=ap-northeast-1#/stacks

## 參考文獻

[^1]: 教學課程：使用 Lambda 和 DynamoDB 建置 CRUD API, https://docs.aws.amazon.com/zh_tw/apigateway/latest/developerguide/http-api-dynamo-db.html

[^2]: Serverless Examples, https://github.com/serverless/examples

[^3]: DynamoDBLocal, https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html#docker

[^4]: Using DynamoDB Locally in a Serverless Framework project, https://gist.github.com/adieuadieu/69d4df97cb3d59bc03a073b013ea06fe

[^5]: @aws-sdk/client-dynamodb, https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/modules.html

[^6]: @aws-sdk/lib-dynamodb, https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_lib_dynamodb.html

[^7]: AWS CLI 的命名設定檔, https://docs.aws.amazon.com/zh_tw/cli/latest/userguide/cli-configure-profiles.html
