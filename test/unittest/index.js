require('should');
const sinon = require('sinon');
const AWS = require('aws-sdk');

const plugin = require('../../src/helper');

const TIMEOUT = 10000;
const provider = {
  getCredentials: () => {
    return {
      credentials: ''
    }
  },
  getRegion: () => {
    return 'us-west-2'
  },
  getStage: () => {
    return 'dev'
  }
}
const serverless = {
  getProvider: () => {
    return provider
  },
  service: {
    custom: {
      globalTables: {}
    },
    provider: {},
    getServiceName: () => {
      return 'service-name'
    }
  },
  cli: {
    consoleLog: (str) => {
      console.log(str);
    }
  }
};

describe('test createGlobalDynamodbTable function', () => {
  const sandbox = sinon.createSandbox();
  beforeEach(() => {
    serverless.service.custom.globalTables = {};
    sandbox.stub(plugin, 'getTableNamesFromStack').returns(Promise.resolve([
      'test-table-name'
    ]));
    sandbox.stub(plugin, 'createGlobalTable').returns(Promise.resolve());
    sandbox.stub(plugin, 'createUpdateCfnStack').returns(Promise.resolve());
  });
  afterEach(() => {
    sandbox.restore();
  });

  it ('should return since global table options is not provided', async () => {
    await plugin.createGlobalDynamodbTable(serverless);
    sandbox.assert.notCalled(plugin.getTableNamesFromStack);
    sandbox.assert.notCalled(plugin.createGlobalTable);
  }).timeout(TIMEOUT);

  it ('should return since no table are present in the stack', async ()=> {
    serverless.service.custom.globalTables = {
      regions: ['us-east-2']
    };
    plugin.getTableNamesFromStack.restore();
    sandbox.stub(plugin, 'getTableNamesFromStack').returns(Promise.resolve([]));
    await plugin.createGlobalDynamodbTable(serverless);
    sandbox.assert.notCalled(plugin.createGlobalTable);
    sandbox.assert.calledOnce(plugin.getTableNamesFromStack);
  }).timeout(TIMEOUT);

  it ('should create the tables without cfn', async ()=> {
    serverless.service.custom.globalTables = {
      regions: ['us-east-2'],
      createStack: false
    };
    await plugin.createGlobalDynamodbTable(serverless);
    sandbox.assert.calledOnce(plugin.createGlobalTable);
    sandbox.assert.calledOnce(plugin.getTableNamesFromStack);
    sandbox.assert.notCalled(plugin.createUpdateCfnStack);
  }).timeout(TIMEOUT);

  it ('should create the tables with cfn', async ()=> {
    serverless.service.custom.globalTables = {
      regions: ['us-east-2']
    };
    await plugin.createGlobalDynamodbTable(serverless);
    sandbox.assert.calledOnce(plugin.createGlobalTable);
    sandbox.assert.calledOnce(plugin.getTableNamesFromStack);
    sandbox.assert.calledOnce(plugin.createUpdateCfnStack);
  }).timeout(TIMEOUT);
});

describe('test checkStackCreateUpdateStatus function', () => {
  it ('should return true', async () => {
    const cfnMockPromise = {
      promise: sinon.fake.resolves({
        Stacks: [
          {
            StackStatus: 'CREATE_COMPLETE'
          }
        ]
      })
    };
    const cfnMock = {
      describeStacks: () => { return cfnMockPromise }
    };
    const resp = await plugin.checkStackCreateUpdateStatus(cfnMock, 'test-stack', 'us-west-2', serverless.cli);
    resp.should.eql(true);
  }).timeout(TIMEOUT);

  it ('should return false', async () => {
    const cfnMockPromise = {
      promise: sinon.fake.resolves({
        Stacks: [
          {
            StackStatus: 'ROLLBACK_COMPLETE'
          }
        ]
      })
    };
    const cfnMock = {
      describeStacks: () => { return cfnMockPromise }
    };
    const resp = await plugin.checkStackCreateUpdateStatus(cfnMock, 'test-stack', 'us-west-2', serverless.cli);
    resp.should.eql(false);
  }).timeout(TIMEOUT);
});

describe('test createUpdateCfnStack function', () => {
  describe('test create stack scenario', () => {
    const cfn = new AWS.CloudFormation();
    before(() => {
      const createStackPromise =  {
        promise: () => { return sinon.fake.resolves()}
      };
      const updateStackPromise = {
        promise: () => sinon.fake.resolves()
      }
      sinon.stub(cfn, 'createStack').returns(createStackPromise);
      sinon.stub(cfn, 'updateStack').returns(updateStackPromise);
      sinon.stub(plugin, 'checkStackCreateUpdateStatus').returns(Promise.resolve(true));
    });
    after(() => {
      cfn.createStack.restore();
      cfn.updateStack.restore();
      plugin.checkStackCreateUpdateStatus.restore();
    });
    it ('should create the stack', async () => {
      await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(plugin.checkStackCreateUpdateStatus);
      sinon.assert.calledOnce(cfn.createStack);
    });
  });

  describe('test update stack scenario', () => {
    const cfn = new AWS.CloudFormation();
    before(() => {
      const error = new Error('forced error');
      error.code = 'AlreadyExistsException';
      const createStackPromise =  {
        promise: () => { return Promise.reject(error) }
      };
      const updateStackPromise = {
        promise: () => sinon.fake.resolves()
      }
      // cfn.createStack = () => { return createStackPromise };
      sinon.stub(cfn, 'createStack').returns(createStackPromise);
      sinon.stub(cfn, 'updateStack').returns(updateStackPromise);
      sinon.stub(plugin, 'checkStackCreateUpdateStatus').returns(Promise.resolve(true));
    });
    after(() => {
      cfn.createStack.restore();
      cfn.updateStack.restore();
      plugin.checkStackCreateUpdateStatus.restore();
    });
    it ('should update the stack', async () => {
      await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(plugin.checkStackCreateUpdateStatus);
      sinon.assert.calledOnce(cfn.createStack);
      sinon.assert.calledOnce(cfn.updateStack);
    });
  });

  describe('createStack fails', () => {
    const cfn = new AWS.CloudFormation();
    before(() => {
      const error = new Error('forced error');
      error.code = 'SomeRandomException';
      const createStackPromise =  {
        promise: () => { return Promise.reject(error) }
      };
      const updateStackPromise = {
        promise: () => sinon.fake.resolves()
      }
      // cfn.createStack = () => { return createStackPromise };
      sinon.stub(cfn, 'createStack').returns(createStackPromise);
      sinon.stub(cfn, 'updateStack').returns(updateStackPromise);
      sinon.stub(plugin, 'checkStackCreateUpdateStatus').returns(Promise.resolve(true));
    });
    after(() => {
      cfn.createStack.restore();
      cfn.updateStack.restore();
      plugin.checkStackCreateUpdateStatus.restore();
    });
    it ('should update the stack', async () => {
      try {
        await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      } catch (err) {
        err.code.should.eql('SomeRandomException');
      }
    });
  });

  describe('update stack scenario throws ValidationError', () => {
    const cfn = new AWS.CloudFormation();
    before(() => {
      const error = new Error('forced error');
      error.code = 'AlreadyExistsException';
      const createStackPromise =  {
        promise: () => { return Promise.reject(error) }
      };
      const updateError = new Error('forced error');
      updateError.code = 'ValidationError';
      const updateStackPromise = {
        promise: () => { return Promise.reject(updateError) }
      }
      // cfn.createStack = () => { return createStackPromise };
      sinon.stub(cfn, 'createStack').returns(createStackPromise);
      sinon.stub(cfn, 'updateStack').returns(updateStackPromise);
      sinon.stub(plugin, 'checkStackCreateUpdateStatus').returns(Promise.resolve(true));
    });
    after(() => {
      cfn.createStack.restore();
      cfn.updateStack.restore();
      plugin.checkStackCreateUpdateStatus.restore();
    });
    it ('should update the stack', async () => {
      await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(plugin.checkStackCreateUpdateStatus);
      sinon.assert.calledOnce(cfn.createStack);
      sinon.assert.calledOnce(cfn.updateStack);
    });
  });

  describe('update stack scenario throws random error', () => {
    const cfn = new AWS.CloudFormation();
    before(() => {
      const error = new Error('forced error');
      error.code = 'AlreadyExistsException';
      const createStackPromise =  {
        promise: () => { return Promise.reject(error) }
      };
      const updateError = new Error('forced error');
      updateError.code = 'SomeError';
      const updateStackPromise = {
        promise: () => { return Promise.reject(updateError) }
      }
      // cfn.createStack = () => { return createStackPromise };
      sinon.stub(cfn, 'createStack').returns(createStackPromise);
      sinon.stub(cfn, 'updateStack').returns(updateStackPromise);
      sinon.stub(plugin, 'checkStackCreateUpdateStatus').returns(Promise.resolve(true));
    });
    after(() => {
      cfn.createStack.restore();
      cfn.updateStack.restore();
      plugin.checkStackCreateUpdateStatus.restore();
    });
    it ('should update the stack', async () => {
      try {
        await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      } catch (err) {
        sinon.assert.notCalled(plugin.checkStackCreateUpdateStatus);
        sinon.assert.calledOnce(cfn.createStack);
        sinon.assert.calledOnce(cfn.updateStack);
        err.code.should.eql('SomeError');
      }
    });
  });
});

describe('test createNewTableAndSetScalingPolicy function', () => {
  let scalingPolicies = [
    {
      PolicyName: 'WriteAutoScalingPolicy',
      TargetTrackingScalingPolicyConfiguration: {}
    }
  ];
  let createTableParams = {
    ProvisionedThroughput: {}
  }
  describe('table already exists', () => {
    const dynamodb = new AWS.DynamoDB();
    const aas = new AWS.ApplicationAutoScaling();
    before(() => {
      const error = new Error('forced error');
      error.code = 'ResourceInUseException';
      const createTablePromise =  {
        promise: () => { return Promise.reject(error) }
      };
      sinon.stub(dynamodb, 'createTable').returns(createTablePromise);
      sinon.stub(aas, 'registerScalableTarget').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'putScalingPolicy').returns({
        promise: () => { return Promise.resolve() }
      });
    });
    after(() => {
      dynamodb.createTable.restore();
      aas.registerScalableTarget.restore();
      aas.putScalingPolicy.restore();
    });
    it ('should return without creating table', async () => {
      await plugin.createNewTableAndSetScalingPolicy(aas, dynamodb, {}, scalingPolicies, 'test-table', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(dynamodb.createTable);
      sinon.assert.notCalled(aas.registerScalableTarget);sinon.assert.notCalled(aas.putScalingPolicy);
    });
  });

  describe('only write scaling policy is set', () => {
    const dynamodb = new AWS.DynamoDB();
    const aas = new AWS.ApplicationAutoScaling();
    before(() => {
      sinon.stub(dynamodb, 'createTable').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'registerScalableTarget').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'putScalingPolicy').returns({
        promise: () => { return Promise.resolve() }
      });
    });
    after(() => {
      dynamodb.createTable.restore();
      aas.registerScalableTarget.restore();
      aas.putScalingPolicy.restore();
    });
    it ('should add write policy', async () => {
      await plugin.createNewTableAndSetScalingPolicy(aas, dynamodb, createTableParams, scalingPolicies, 'test-table', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(dynamodb.createTable);
      sinon.assert.calledOnce(aas.registerScalableTarget);sinon.assert.calledOnce(aas.putScalingPolicy);
    });
  });

  describe('read write scaling policy is set', () => {
    const dynamodb = new AWS.DynamoDB();
    const aas = new AWS.ApplicationAutoScaling();
    before(() => {
      scalingPolicies.push({
        PolicyName: 'ReadAutoScalingPolicy',
        TargetTrackingScalingPolicyConfiguration: {}
      })
      sinon.stub(dynamodb, 'createTable').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'registerScalableTarget').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'putScalingPolicy').returns({
        promise: () => { return Promise.resolve() }
      });
    });
    after(() => {
      dynamodb.createTable.restore();
      aas.registerScalableTarget.restore();
      aas.putScalingPolicy.restore();
    });
    it ('should set read write policy', async () => {
      await plugin.createNewTableAndSetScalingPolicy(aas, dynamodb, createTableParams, scalingPolicies, 'test-table', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(dynamodb.createTable);
      sinon.assert.calledTwice(aas.registerScalableTarget);sinon.assert.calledTwice(aas.putScalingPolicy);
    });
  });

  describe('createTable fails with random error', () => {
    const dynamodb = new AWS.DynamoDB();
    const aas = new AWS.ApplicationAutoScaling();
    before(() => {
      const error = new Error('forced error');
      error.code = 'RandomError';
      const createTablePromise =  {
        promise: () => { return Promise.reject(error) }
      };
      sinon.stub(dynamodb, 'createTable').returns(createTablePromise);
      sinon.stub(aas, 'registerScalableTarget').returns({
        promise: () => { return Promise.resolve() }
      });
      sinon.stub(aas, 'putScalingPolicy').returns({
        promise: () => { return Promise.resolve() }
      });
    });
    after(() => {
      dynamodb.createTable.restore();
      aas.registerScalableTarget.restore();
      aas.putScalingPolicy.restore();
    });
    it ('should return without creating table', async () => {
      try {
        await plugin.createNewTableAndSetScalingPolicy(aas, dynamodb, {}, scalingPolicies, 'test-table', 'us-west-2', serverless.cli);
      } catch (err) {
        sinon.assert.calledOnce(dynamodb.createTable);
        sinon.assert.notCalled(aas.registerScalableTarget);sinon.assert.notCalled(aas.putScalingPolicy);
        err.code.should.eql('RandomError');
      }
    });
  });
});

describe('test getRegionsToCreateGlobalTablesIn function', () =>{
  const dynamodb = new AWS.DynamoDB();
  const newRegions = [
    'us-west-1',
    'us-east-1'
  ]
  describe('no global table exists for v1', () => {
    before(() => {
      const error = new Error('forced error');
      error.code = 'GlobalTableNotFoundException';
      sinon.stub(dynamodb, 'describeGlobalTable').returns({
        promise: () => { return Promise.reject(error)}
      });
    });
    after(() => {
      dynamodb.describeGlobalTable.restore();
    });
    it ('should return all the new regions', async () => {
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v1', serverless.cli);
      resp.missingRegions.should.have.length(2);
      resp.missingRegions.should.eql(newRegions);
      resp.addingNewRegions.should.eql(false);
    });
  });

  describe('no global table exists for v2', () => {
    before(() => {
      const error = new Error('forced error');
      error.code = 'GlobalTableNotFoundException';
      sinon.stub(dynamodb, 'describeTable').returns({
        promise: () => { return Promise.reject(error)}
      });
    });
    after(() => {
      dynamodb.describeTable.restore();
    });
    it ('should return all the new regions', async () => {
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v2', serverless.cli);
      resp.missingRegions.should.have.length(2);
      resp.missingRegions.should.eql(newRegions);
      resp.addingNewRegions.should.eql(false);
    });
  });

  describe('describeGlobalTable fails with random error', () => {
    before(() => {
      const error = new Error('forced error');
      error.code = 'RandomError';
      sinon.stub(dynamodb, 'describeGlobalTable').returns({
        promise: () => { return Promise.reject(error)}
      });
    });
    after(() => {
      dynamodb.describeGlobalTable.restore();
    });
    it ('should return all the new regions', async () => {
      try {
        await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v1', serverless.cli);
      } catch (err) {
        err.code.should.eql('RandomError');
      }
    });
  });

  describe('global table exists in all the specified new regions', () => {
    before(() => {
      sinon.stub(dynamodb, 'describeGlobalTable').returns({
        promise: () => { return Promise.resolve({
          GlobalTableDescription: {
            ReplicationGroup: [
              { RegionName: 'us-west-1'},
              { RegionName: 'us-east-1'},
              { RegionName: 'us-west-2'}
            ]
          }
        })}
      });
    });
    after(() => {
      dynamodb.describeGlobalTable.restore();
    });
    it ('should return no region', async () => {
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v1', serverless.cli);
      resp.missingRegions.should.have.length(0);
      resp.addingNewRegions.should.eql(false);
    });
  });

  describe('global table exists in all the specified new regions', () => {
    before(() => {
      sinon.stub(dynamodb, 'describeGlobalTable').returns({
        promise: () => { return Promise.resolve({
          GlobalTableDescription: {
            ReplicationGroup: [
              { RegionName: 'us-west-1'},
              { RegionName: 'us-west-2'}
            ]
          }
        })}
      });
    });
    after(() => {
      dynamodb.describeGlobalTable.restore();
    });
    it ('should return no region', async () => {
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v1', serverless.cli);
      resp.missingRegions.should.have.length(1);
      resp.missingRegions[0].should.eql('us-east-1');
      resp.addingNewRegions.should.eql(true);
    });
  });

  describe('global table exists in all the specified new regions for v2', () => {
    before(() => {
      sinon.stub(dynamodb, 'describeTable').returns({
        promise: () => { return Promise.resolve({
          Table: {
            Replicas: [
              { RegionName: 'us-west-1'},
              { RegionName: 'us-west-2'}
            ]
          }
        })}
      });
    });
    after(() => {
      dynamodb.describeTable.restore();
    });
    it ('should return no region', async () => {
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', 'v2', serverless.cli);
      resp.missingRegions.should.have.length(1);
      resp.missingRegions[0].should.eql('us-east-1');
      resp.addingNewRegions.should.eql(true);
    });
  });
});

describe('test createGlobalTable function', () => {
  const sandbox = sinon.createSandbox();
  let dynamodb;
  let aas;
  let stubbedTable;
  beforeEach(() => {
    stubbedTable = {
      Table: {
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        },
        GlobalSecondaryIndexes: [
          {
            IndexName: 'gsi',
            KeySchema: '',
            Projection: '',
            ProvisionedThroughput: {}
          }
        ],
        LocalSecondaryIndexes: [
          {
            IndexName: 'lsi',
            KeySchema: '',
            Projection: ''
          }
        ],
        AttributeDefinitions: {},
        KeySchema: '',
      }
    };
    dynamodb = new AWS.DynamoDB({ region: 'us-west-2' });
    aas = new AWS.ApplicationAutoScaling({ region: 'us-west-2' });
    sandbox.stub(plugin, 'getRegionsToCreateGlobalTablesIn').returns(Promise.resolve({
      missingRegions: ['us-west-1'],
      addingNewRegions: false
    }));
    sandbox.stub(dynamodb, 'describeTable').returns({
      promise: () => { return Promise.resolve(stubbedTable)}
    });
    sandbox.stub(dynamodb, 'listTagsOfResource').returns({
      promise: () => { return Promise.resolve({
        Tags: {}
      })}
    });
    sandbox.stub(aas, 'describeScalingPolicies').returns({
      promise: () => { return Promise.resolve([]) }
    });
    sandbox.stub(plugin, 'createNewTableAndSetScalingPolicy').returns(Promise.resolve());
    sandbox.stub(dynamodb, 'createGlobalTable').returns({
      promise: () => { return Promise.resolve()}
    });
    sandbox.stub(dynamodb, 'updateGlobalTable').returns({
      promise: () => { return Promise.resolve()}
    });
    sandbox.stub(dynamodb, 'updateTable').returns({
      promise: () => { return Promise.resolve()}
    });
    sandbox.stub(dynamodb, 'waitFor').returns({
      promise: () => { return Promise.resolve()}
    });
  });
  afterEach(() => {
    sandbox.restore();
  });

  it ('should return if no region to update', async () => {
    plugin.getRegionsToCreateGlobalTablesIn.restore();
    sandbox.stub(plugin, 'getRegionsToCreateGlobalTablesIn').returns(Promise.resolve({
      missingRegions: [],
      addingNewRegions: false
    }));
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v1',true, serverless.cli);
    sandbox.assert.notCalled(dynamodb.createGlobalTable);
  });

  it ('should create global table', async () => {
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v1', true, serverless.cli);
    sandbox.assert.calledOnce(dynamodb.createGlobalTable);
  });

  it ('should update the global table', async () => {
    plugin.getRegionsToCreateGlobalTablesIn.restore();
    sandbox.stub(plugin, 'getRegionsToCreateGlobalTablesIn').returns(Promise.resolve({
      missingRegions: ['us-west-1'],
      addingNewRegions: true
    }));
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v1', true, serverless.cli);
    sandbox.assert.notCalled(dynamodb.createGlobalTable);
    sandbox.assert.calledOnce(dynamodb.updateGlobalTable);
  });
  
  context("when create stack is false", () => {
    it ('should create the table with ProvisionedThroughput if billing mode is not PAY_PER_REQUEST', async () => {
      await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v1', false, serverless.cli);
      sandbox.assert.calledOnce(dynamodb.describeTable);
      plugin.createNewTableAndSetScalingPolicy.lastCall.args[2].should.eql({ AttributeDefinitions: {},
        KeySchema: '',
        TableName: 'test-table',
        StreamSpecification:
         { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
        GlobalSecondaryIndexes:
         [ { IndexName: 'gsi',
             KeySchema: '',
             Projection: '',
             ProvisionedThroughput: {} } ],
        LocalSecondaryIndexes: [ { IndexName: 'lsi', KeySchema: '', Projection: '' } ],
        "ProvisionedThroughput": {
              "ReadCapacityUnits": 5,
              "WriteCapacityUnits": 5
            },
        Tags: {} });
    });
    
    it ('should create the table without ProvisionedThroughput if billing mode is PAY_PER_REQUEST', async () => {
      stubbedTable.Table.BillingModeSummary = { BillingMode: "PAY_PER_REQUEST" };
      await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v1', false, serverless.cli);
      sandbox.assert.calledOnce(dynamodb.describeTable);
      plugin.createNewTableAndSetScalingPolicy.lastCall.args[2].should.eql({ AttributeDefinitions: {},
        KeySchema: '',
        TableName: 'test-table',
        StreamSpecification:
         { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
        GlobalSecondaryIndexes:
         [ { IndexName: 'gsi',
             KeySchema: '',
             Projection: '',
             ProvisionedThroughput: {} } ],
        LocalSecondaryIndexes: [ { IndexName: 'lsi', KeySchema: '', Projection: '' } ],
        BillingMode: 'PAY_PER_REQUEST',
        Tags: {} });
    });

    it ('should create the table by using v2 version', async () => {
      stubbedTable.Table.BillingModeSummary = { BillingMode: "PAY_PER_REQUEST" };
      await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], 'v2', false, serverless.cli);
      sandbox.assert.calledOnce(dynamodb.updateTable);
      sandbox.assert.calledTwice(dynamodb.waitFor);
    });
  })
});

describe('test getTableNamesFromStack function', () => {
  let cfn;
  before(() => {
    cfn = new AWS.CloudFormation();
    sinon.stub(cfn, 'listStackResources').returns({
      promise: () => { return Promise.resolve({
        StackResourceSummaries: [
          {
            ResourceType: 'AWS::DynamoDB::Table',
            PhysicalResourceId: 'test-table'
          },
          {
            ResourceType: 'AWS::S3::Bucket',
            PhysicalResourceId: 'test-bucket'
          }
        ]
      }) }
    });
  });
  after(() => {
    cfn.listStackResources.restore();
  });
  it ('should return test-table', async () => {
    const resp = await plugin.getTableNamesFromStack(cfn, 'test-stack');
    resp.should.have.length(1);
    resp[0].should.eql('test-table');
  });
});

describe('test getTableNamesFromStack function no DynamoDb found', () => {
  let cfn;
  before(() => {
    cfn = new AWS.CloudFormation();
    sinon.stub(cfn, 'listStackResources').returns({
      promise: () => { return Promise.resolve({
        StackResourceSummaries: [
          {
            ResourceType: 'AWS::S3::Bucket',
            PhysicalResourceId: 'test-bucket'
          }
        ]
      }) }
    });
  });
  after(() => {
    cfn.listStackResources.restore();
  });
  it ('should return test-table', async () => {
    const resp = await plugin.getTableNamesFromStack(cfn, 'test-stack');
    resp.should.have.length(0);
  });
});
