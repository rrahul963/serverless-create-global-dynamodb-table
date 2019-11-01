const AWS = require('aws-sdk')
const chalk = require('chalk')
const get = require('lodash.get');

const WRITEAUOTSCALINGPOLICY = 'WriteAutoScalingPolicy';
const READAUOTSCALINGPOLICY = 'ReadAutoScalingPolicy';
const TRUE = true;

const STACKCOMPLETESTATUSES = [
  'CREATE_COMPLETE',
  'ROLLBACK_FAILED',
  'ROLLBACK_COMPLETE',
  'UPDATE_COMPLETE',
  'UPDATE_ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_COMPLETE'
];

/**
 * Function to add a desired amount of delay/sleep.
 * @param {int} ms milliseconds to sleep
 */
const sleep = function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Check the status of cloudformation stack.
 * @param {Object} cfn AWS Cloudformation bject
 * @param {string} stackName Cloudformation stack name
 * @param {string} region AWS region
 * @param {Object} cli Serverless cli object
 * @returns {boolean} True if stack is created/updated successfully, else false.
 */
const checkStackCreateUpdateStatus = async function checkStackCreateUpdateStatus(cfn, stackName, region, cli) {
  cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Checking cloudformation stack ${stackName} status in ${region}...`)}`);
  let status;
  let dotPrinted = false;
  while (TRUE) {
    const resp = await cfn.describeStacks({
      StackName: stackName
    }).promise();
    if (STACKCOMPLETESTATUSES.includes(resp.Stacks[0].StackStatus)) {
      status = resp.Stacks[0].StackStatus;
      break;
    }
    cli.printDot();
    dotPrinted = true;
    await sleep(5000);
  }
  if (dotPrinted) {
    cli.consoleLog('\n');
  }
  if (status.includes('ROLLBACK')) {
    cli.consoleLog(`CreateGlobalTable: ${chalk.red(`Failed to create/update the stack ${stackName} in ${region}... \n
    Please check the stack status in console and retry.`)}`);
    return false;
  }
  return true;
};

/**
 * Invokes cloudformation create or update command.
 * @param {Object} cfn AWS Cloudformation object
 * @param {Object} template Cloudformation template
 * @param {string} stackName Cloudformation stack name
 * @param {string} region AWS region
 * @param {Object} cli Serverless cli object
 */
const createUpdateCfnStack = async function createUpdateCfnStack(cfn, template, stackName, region, cli) {
  cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Creating/Updating cloudformation stack ${stackName} in ${region}...`)}`);
  let update = false;
  try {
    const createStackParams = {
      StackName: stackName,
      TemplateBody: JSON.stringify(template),
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM']
    };
    await cfn.createStack(createStackParams).promise();
  } catch (err) {
    if (err.code === 'AlreadyExistsException') {
      update = true;
    } else {
      throw err;
    }
  }
  if (update) {
    try {
      const updateStackParams = {
        StackName: stackName,
        TemplateBody: JSON.stringify(template),
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM']
      };
      await cfn.updateStack(updateStackParams).promise();
    } catch (err) {
      if (err.code !== 'ValidationError') {
        throw err;
      }
    }
  }
  const stackSuccess = await module.exports.checkStackCreateUpdateStatus(cfn, stackName, region, cli);
  if (stackSuccess) {
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Cloudformation stack ${stackName} successfully created/updated in ${region}...`)}`);
  }
}

/**
 * Creates new dynamodb table in specified region and if scaling policy is provided
 * attaches the scaling policy to new table.
 * @param {Object} appAutoScaling AWS Application AutoScaling object
 * @param {Object} dynamodb AWS Dynamodb object
 * @param {Object} createTableParams Dynamodb create table params
 * @param {Array} scalingPolicies Scaling policies on source dynamodb table
 * @param {string} tableName Dynamodb table name
 * @param {string} region AWS region in which table needs to be created
 * @param {Object} cli Serverless cli object
 */
const createNewTableAndSetScalingPolicy = async function createNewTableAndSetScalingPolicy(
  appAutoScaling, dynamodb, createTableParams, scalingPolicies=[], tableName, region, cli
) {
  cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Creating new table ${tableName} in ${region} region...`)}`)
  try {
    await dynamodb.createTable(createTableParams).promise()
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created new table ${tableName} in ${region} region...`)}`)
    if (scalingPolicies.length) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Adding auto scaling setting')}`);
      const writePolicy = scalingPolicies.find(p => p.PolicyName === WRITEAUOTSCALINGPOLICY);
      const readPolicy = scalingPolicies.find(p => p.PolicyName === READAUOTSCALINGPOLICY);
      if (writePolicy) {
        const regScalableTargetParams = {
          ResourceId: `table/${tableName}`,
          ScalableDimension: `dynamodb:table:WriteCapacityUnits`,
          ServiceNamespace: 'dynamodb',
          MinCapacity: createTableParams.ProvisionedThroughput.WriteCapacityUnits,
          MaxCapacity: createTableParams.ProvisionedThroughput.WriteCapacityUnits
        };
        await appAutoScaling.registerScalableTarget(regScalableTargetParams).promise();
        cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Registered Write Scalable target')}`);
        const scalingParam = {
          PolicyName: WRITEAUOTSCALINGPOLICY,
          ResourceId: `table/${tableName}`,
          ScalableDimension: `dynamodb:table:WriteCapacityUnits`,
          ServiceNamespace: 'dynamodb',
          PolicyType: 'TargetTrackingScaling',
          TargetTrackingScalingPolicyConfiguration: { ...writePolicy.TargetTrackingScalingPolicyConfiguration }
        };
        await appAutoScaling.putScalingPolicy(scalingParam).promise();
        cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Added Write Scaling policy')}`);
      }
      if (readPolicy) {
        const regScalableTargetParams = {
          ResourceId: `table/${tableName}`,
          ScalableDimension: `dynamodb:table:ReadCapacityUnits`,
          ServiceNamespace: 'dynamodb',
          MinCapacity: createTableParams.ProvisionedThroughput.ReadCapacityUnits,
          MaxCapacity: createTableParams.ProvisionedThroughput.ReadCapacityUnits
        };
        await appAutoScaling.registerScalableTarget(regScalableTargetParams).promise();
        cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Registered Read Scalable target')}`);
        const scalingParam = {
          PolicyName: READAUOTSCALINGPOLICY,
          ResourceId: `table/${tableName}`,
          ScalableDimension: `dynamodb:table:ReadCapacityUnits`,
          ServiceNamespace: 'dynamodb',
          PolicyType: 'TargetTrackingScaling',
          TargetTrackingScalingPolicyConfiguration: { ...readPolicy.TargetTrackingScalingPolicyConfiguration }
        };
        await appAutoScaling.putScalingPolicy(scalingParam).promise();
        cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Added Read Scaling policy')}`);
      }
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Auto scaling policy added successfully')}`);
    }
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Table ${tableName} already exists in the region ${region}`)}`)
      return Promise.resolve();
    }
    throw error
  }
}

/**
 * Checks if the global table alreday exists in certain regions.
 * @param {Object} dynamodb AWS Dynamodb object
 * @param {string} region AWS region in which source table exists
 * @param {Array} newRegions List of regions in which global tables needs to be created
 * @param {string} tableName Dynamodb table name
 * @param {Object} cli Serverless cli object
 * @returns {Object} List of regions in which gloabl table needs to be created and flag indicating
 * if some global table setup already exists.
 */
const getRegionsToCreateGlobalTablesIn = async function getRegionsToCreateGlobalTablesIn(
  dynamodb, region, newRegions, tableName, cli
) {
  try {
    const resp = await dynamodb.describeGlobalTable({ GlobalTableName: tableName }).promise()
    const regionsGlobalTableExists = resp.GlobalTableDescription.ReplicationGroup.map(rg => rg.RegionName);
    const missingRegions = [region].concat(newRegions).filter(r => !regionsGlobalTableExists.includes(r));
    if (missingRegions.length === 0) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Global table ${tableName} already exists in all the specified regions. Skipping creation...`)}`)
      return {missingRegions: [], addingNewRegions: false };
    }
    return { missingRegions, addingNewRegions: true };
  } catch (e) {
    if (e.code !== 'GlobalTableNotFoundException') {
      throw e
    }
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Global table doesn\'t exist...')}`)
    return { missingRegions: newRegions, addingNewRegions: false };
  }
};

/**
 * 1. Create global tables if they have not been created using cloudformation
 * 2. setup global table relation between the tables.
 * @param {Object} appAutoScaling AWS Application AutoScaling object
 * @param {Object} dynamodb AWS Dynamodb object
 * @param {Object} creds AWS credentials object
 * @param {string} region AWS region in which source table exists
 * @param {string} tableName Dymanodb table name
 * @param {Array} newRegions List of regions in which global table needs to be setup
 * @param {boolean} createStack flag indicating if the tables were created using cloudformation
 * @param {Object} cli Serverless cli object
 */
const createGlobalTable = async function createGlobalTable(
  appAutoScaling, dynamodb, creds, region, tableName, newRegions, createStack, cli
) {

  const { missingRegions: regionsToUpdate, addingNewRegions } = await module.exports.getRegionsToCreateGlobalTablesIn(
    dynamodb, region, newRegions, tableName, cli
  );

  if (!regionsToUpdate.length) {
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Global table setup already in place.`)}`);
    return;
  }

  if (!createStack) {
    const tableDef = await dynamodb.describeTable({ TableName: tableName }).promise()
    const { ReadCapacityUnits, WriteCapacityUnits } = tableDef.Table.ProvisionedThroughput
    const { GlobalSecondaryIndexes, LocalSecondaryIndexes } = tableDef.Table;
    const globalSecondaryIndexes = [];
    const localSecondaryIndexes = [];
    if (GlobalSecondaryIndexes) {
      GlobalSecondaryIndexes.forEach(gsi => {
        globalSecondaryIndexes.push({
          IndexName: gsi.IndexName,
          KeySchema: gsi.KeySchema,
          Projection: gsi.Projection,
          ProvisionedThroughput: gsi.ProvisionedThroughput
        })
      })
    }
    if (LocalSecondaryIndexes) {
      LocalSecondaryIndexes.forEach(lsi => {
        localSecondaryIndexes.push({
          IndexName: lsi.IndexName,
          KeySchema: lsi.KeySchema,
          Projection: lsi.Projection
        })
      })
    }
    const createTableParams = {
      AttributeDefinitions: tableDef.Table.AttributeDefinitions,
      KeySchema: tableDef.Table.KeySchema,
      ProvisionedThroughput: { ReadCapacityUnits, WriteCapacityUnits },
      TableName: tableName,
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      },
      GlobalSecondaryIndexes: globalSecondaryIndexes.length ? globalSecondaryIndexes : undefined,
      LocalSecondaryIndexes: localSecondaryIndexes.length ? localSecondaryIndexes : undefined
    };

    const tags = await dynamodb.listTagsOfResource({ ResourceArn: tableDef.Table.TableArn }).promise();
    createTableParams.Tags = tags.Tags;

    const describeScalingPoliciesResp = await appAutoScaling.describeScalingPolicies({
      ServiceNamespace: 'dynamodb',
      ResourceId: `table/${tableName}`
    }).promise();

    await Promise.all(regionsToUpdate.map(r => {
      const ddb = new AWS.DynamoDB({
        credentials: creds,
        region: r,
      });
      const aas = new AWS.ApplicationAutoScaling({
        credentials: creds,
        region: r,
      });
      return module.exports.createNewTableAndSetScalingPolicy(
        aas, ddb, createTableParams, describeScalingPoliciesResp.ScalingPolicies, tableName, r, cli
      );
    }));
  }

  if (!addingNewRegions) {
    const replicationGroup = [{ RegionName: region }]
    regionsToUpdate.forEach(r => replicationGroup.push({ RegionName: r }))

    const param = {
      GlobalTableName: tableName,
      ReplicationGroup: replicationGroup,
    }
    await dynamodb.createGlobalTable(param).promise()
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created global table setup for ${tableName}...`)}`)
  } else {
    const replicaUpdates = [];
    regionsToUpdate.forEach(r => replicaUpdates.push({ Create:{ RegionName: r }}));
    const param = {
      GlobalTableName: tableName,
      ReplicaUpdates: replicaUpdates,
    }
    await dynamodb.updateGlobalTable(param).promise();
    cli.consoleLog(`CreateGlobalTable: ${chalk.yellow(`Created global table setup for ${tableName}...`)}`)
  }
}

/**
 * Get the list if dynamodb table names from stack resources.
 * @param {Object} cfn AWS Cloudformation object
 * @param {string} stackName Cloudformation stack name
 * @returns {Array} List of table names.
 */
const getTableNamesFromStack = async function getTableNamesFromStack(cfn, stackName){
  const resp = await cfn.describeStackResources({ StackName: stackName }).promise();
  const tablesInStack = resp.StackResources.filter(r => r.ResourceType === 'AWS::DynamoDB::Table');
  return tablesInStack.map(t => t.PhysicalResourceId);
}

/**
 * The create global table function.
 * This function will:
 * 1. get the list of table names from stack resources.
 * 2. get the custom settings specified by user for setting up global tables.
 * 3. deploy cfn stacks in the regions specified by the user (if createSTack is true)
 * 4. setup the global table relation.
 *
 * @param      {Object}  serverless  The serverless
 */
const createGlobalDynamodbTable = async function createGlobalDynamodbTable(serverless) {
  try {
    serverless.cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Starting setting up global tables...')}`)
    const provider = serverless.getProvider('aws');
    const awsCredentials = provider.getCredentials();
    const region = provider.getRegion();
    const serviceName = serverless.service.getServiceName();
    const stage = provider.getStage();
    const stackName = `${serviceName}-${stage}`;
    const cli = serverless.cli;

    const globalTablesOptions = get(serverless, 'service.custom.globalTables');
    if (!globalTablesOptions || Object.keys(globalTablesOptions).length === 0) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('Global Table configuration missing, skipping creation...')}`)
      return
    }

    const cfn = new AWS.CloudFormation({
      credentials: awsCredentials.credentials,
      region,
    });

    const dynamodb = new AWS.DynamoDB({
      credentials: awsCredentials.credentials,
      region,
    });

    const tableNames = await module.exports.getTableNamesFromStack(cfn, stackName);
    if (!tableNames.length) {
      cli.consoleLog(`CreateGlobalTable: ${chalk.yellow('No table has been created as part of this stack. Skipping global table setup.')}`);
      return;
    }

    if (globalTablesOptions.createStack === false) {
      const applicationautoscaling = new AWS.ApplicationAutoScaling({
        credentials: awsCredentials.credentials,
        region,
      });

      for (let tableName of tableNames) {
        await module.exports.createGlobalTable(
          applicationautoscaling,
          dynamodb,
          awsCredentials.credentials,
          region,
          tableName,
          globalTablesOptions.regions,
          false,
          cli
        )
      }
    } else {
      const cfnTemplate = serverless.service.provider.compiledCloudFormationTemplate;
      for (let newRegion of globalTablesOptions.regions) {
        let cfn = new AWS.CloudFormation({
          region: newRegion,
          credentials: awsCredentials.credentials
        })
        await module.exports.createUpdateCfnStack(cfn, cfnTemplate, stackName, newRegion, cli);
      }

      for (let tableName of tableNames) {
        await module.exports.createGlobalTable(
          null,
          dynamodb,
          awsCredentials.credentials,
          region,
          tableName,
          globalTablesOptions.regions,
          true,
          cli
        )
      }
    }
  } catch (error) {
    serverless.cli.consoleLog(`CreateGlobalTable: ${chalk.red(`Failed to setup global table. Error ${error.message || error}`)}`)
  }
}

module.exports = {
  checkStackCreateUpdateStatus,
  createGlobalDynamodbTable,
  createGlobalTable,
  createNewTableAndSetScalingPolicy,
  createUpdateCfnStack,
  getRegionsToCreateGlobalTablesIn,
  getTableNamesFromStack,
  sleep
}
