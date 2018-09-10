const AWS = require('aws-sdk')
const chalk = require('chalk')

/**
 * Create dynamodb table.
 * @param {string} region region
 * @param {string} tableName Dynamodb table name
 * @param {Object} setting Table creation params
 * @param {Object} cli Serverless cli object for console logging
 * @param {Object} creds AWS credentials
 */
const createAndTagTable = async function createAndTagTable(region, tableName, setting, tags, cli, creds) {
  const dynamodb = new AWS.DynamoDB({
    credentials: creds,
    region,
  })
  try {

    try {
      await dynamodb.describeTable({TableName: tableName}).promise();
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Backup region table already exists in ${region}. Skipping creation...')}`);
      return
    }
    catch (e) {
      if (e.code !== 'ResourceNotFoundException') {
        throw e
      }
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Backup region table doesnt exist yet in ${region}. Creating...')}`)
    }

    const createResp = await dynamodb.createTable(setting).promise()
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created new table ${tableName} in ${region} region...`)}`);
    const { TableArn } = createResp.TableDescription;
    if (tags) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`CAdding tags to table ${tableName} in ${region} region...`)}`);
      await dynamodb.tagResource({ ResourceArn: TableArn, Tags: tags });
    }

  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Table ${tableName} already exists in the region ${region}`)}`)
    }
    throw error
  }
}

/**
 * This method sets up the global table in new region
 * 1. Checks if the global table already exists.
 * 2. Create a table with same name in new regions.
 * 3. Create global table between the tables.
 * @param {Object} creds AWS temporary credentials
 * @param {string} region Region in which primary table exists
 * @param {string} tableName primary table name
 * @param {Array} newRegions Regions in which global table needs to be setup
 * @param {Object} cli Serverless wrapper to wtite console logs.
 */
const createGlobalTable = async function createGlobalTable(
  creds,
  region,
  tableName,
  newRegions,
  tags,
  cli,
) {
  const dynamodb = new AWS.DynamoDB({
    credentials: creds,
    region,
  })
  try {
    await dynamodb.describeGlobalTable({ GlobalTableName: tableName }).promise()
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Global table already exists. Skipping creation...')}`)
    return
  } catch (e) {
    if (e.code !== 'GlobalTableNotFoundException') {
      throw e
    }
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Global table doesn\'t exist...')}`)
  }

  const tableDef = await dynamodb.describeTable({ TableName: tableName }).promise()

  const { ReadCapacityUnits, WriteCapacityUnits } = tableDef.Table.ProvisionedThroughput
  const createTableParams = {
    AttributeDefinitions: tableDef.Table.AttributeDefinitions,
    KeySchema: tableDef.Table.KeySchema,
    ProvisionedThroughput: { ReadCapacityUnits, WriteCapacityUnits },
    TableName: tableName,
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  }

  await Promise.all(newRegions.map(r => createAndTagTable(r, tableName, createTableParams, tags, cli, creds)))

  const replicationGroup = [{ RegionName: region }]
  newRegions.forEach(r => replicationGroup.push({ RegionName: r }))

  const param = {
    GlobalTableName: tableName,
    ReplicationGroup: replicationGroup,
  }
  await dynamodb.createGlobalTable(param).promise()
  cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created global table setup for ${tableName}...`)}`)
}

/**
 * The create global table function.
 * This function will:
 * 1. get the stack outputs.
 * 2. get the custom settings specified by user for setting up global tables.
 * 3. get the table names from stack output.
 * 4. create the global table.
 *
 * @param      {Object}  serverless  The serverless
 */
const createGlobalDynamodbTable = async function createGlobalDynamodbTable(serverless) {
  try {
    serverless.cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Starting setting up global tables...')}`)
    const awsCredentials = serverless.getProvider('aws').getCredentials()
    const cfn = new AWS.CloudFormation({
      credentials: awsCredentials.credentials,
      region: serverless.getProvider('aws').getRegion(),
    })
    const stackName = `${serverless.service.getServiceName()}-${serverless.getProvider('aws').getStage()}`
    const resp = await cfn.describeStacks({ StackName: stackName }).promise()
    const outputs = resp.Stacks[0].Outputs

    const globalTablesOptions = serverless.service.custom.globalTables
    if (!globalTablesOptions || globalTablesOptions.length === 0) {
      return
    }
    await Promise.all(globalTablesOptions.map((option) => {
      if (option.tableKey) {
        outputs.some((output) => {
          let tableName = ''
          if (output.OutputKey === option.tableKey) {
            tableName = output.OutputValue
            createGlobalTable(
              awsCredentials.credentials,
              serverless.getProvider('aws').getRegion(),
              tableName,
              option.regions,
              option.tags,
              serverless.cli,
            )
            return true
          }
          return false
        })
      } else if (option.tableName) {
        createGlobalTable(
          awsCredentials.credentials,
          serverless.getProvider('aws').getRegion(),
          option.tableName,
          option.regions,
          option.tags,
          serverless.cli,
        )
      } else {
        throw new Error('Table key or table name is required for setting up global table.')
      }
      return true
    }))
  } catch (error) {
    serverless.cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Failed to setup global table. Error ${error.message || error}`)}`)
  }
}

/**
 * The class that will be used as serverless plugin.
 */
class CreateGlobalDynamodbTable {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.hooks = {
      'after:deploy:deploy': function () {
        createGlobalDynamodbTable(serverless)
      },
    }
  }
}

module.exports = CreateGlobalDynamodbTable
