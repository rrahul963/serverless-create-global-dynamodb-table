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
  cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Creating new table ${tableName} in ${region} region...`)}`)
  const dynamodb = new AWS.DynamoDB({
    credentials: creds,
    region,
  })
  try {
    const createResp = await dynamodb.createTable(setting).promise()
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created new table ${tableName} in ${region} region...`)}`)
    const { TableArn } = createResp.TableDescription
    if (tags) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`CAdding tags to table ${tableName} in ${region} region...`)}`)
      await dynamodb.tagResource({ ResourceArn: TableArn, Tags: tags })
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
    // TODO should verify that the replica regions are added. if not, attempt to create and add them
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

const deleteBackupRegionGlobalTable = async function deleteTable(tableName, backupRegion, creds, cli) {
  const dynamodb = new AWS.DynamoDB({
    credentials: creds,
    region: backupRegion,
  })
  try {
    await dynamodb.deleteTable({ TableName: tableName }).promise()
    cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow(`Deleted backup region table ${backupRegion} table ${tableName}`)}`)
  } catch (e) {
    if (e.code === 'ResourceNotFoundException') {
      cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow(`Skipping ${backupRegion} for table ${tableName}. The table is already deleted`)}`)
    } else {
      cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow(`Unable to delete region ${backupRegion}'s global table ${tableName}. Delete table error code: ${e.code} message: ${e.message}`)}`)
      throw e
    }
  }
}

/**
 * This method removes the global table in new region
 * Attempts to delete the global table and all associated backup tables
 *
 * @param {Object} creds AWS temporary credentials
 * @param {string} tableName primary table name
 * @param {Array} backupRegions backup regions that need their tables removed
 * @param {Object} cli Serverless wrapper to write console logs.
 */
const deleteBackupRegionGlobalTables = async function deleteGlobalTable(
  creds,
  tableName,
  backupRegions,
  cli,
) {
  await Promise.all(backupRegions.map(backupRegion => deleteBackupRegionGlobalTable(tableName, backupRegion, creds, cli)))
  return true
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

const deleteGlobalAndBackupTables = async function deleteGlobalAndBackupTables(serverless) {
  try {
    serverless.cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow('Starting to delete backup region global tables...')}`)
    const awsCredentials = serverless.getProvider('aws').getCredentials()

    const globalTablesOptions = serverless.service.custom.globalTables
    if (!globalTablesOptions || globalTablesOptions.length === 0) {
      return
    }
    await Promise.all(globalTablesOptions.map((option) => {
      if (option.tableKey) {
        serverless.cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow('Warning: backup region global tables not removed. ' +
          'tableKey serverless.yml option not supported for removal. Switch to tableName for this cleanup to work')}`)
        return false
      } else if (option.tableName) {
        return deleteBackupRegionGlobalTables(
          awsCredentials.credentials,
          option.tableName,
          option.regions,
          serverless.cli,
        )
      } else {
        throw new Error('Table key or table name is required for removing global tables.')
      }
    }))
  } catch (error) {
    serverless.cli.consoleLog(`DeleteGlobalTable: ${chalk.yellow(`Failed to delete backup region global tables. Error ${error.message || error}`)}`)
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
      'remove:remove': function () {
        deleteGlobalAndBackupTables(serverless)
      },
    }
  }
}

module.exports = CreateGlobalDynamodbTable
