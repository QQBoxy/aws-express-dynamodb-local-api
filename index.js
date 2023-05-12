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
    res.status(500).json({ error: "Could not retrieve user" });
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
    res.status(500).json({ error: "Could not retrieve user" });
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
    res.status(500).json({ error: "Could not retrieve user" });
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
    res.status(500).json({ error: "Could not retrieve user" });
  }
});

module.exports.handler = serverless(app);