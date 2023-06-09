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