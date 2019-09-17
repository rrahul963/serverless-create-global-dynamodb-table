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
    it ('should update the stack', async () => {
      await plugin.createUpdateCfnStack(cfn, {}, 'test-stack', 'us-west-2', serverless.cli);
      sinon.assert.calledOnce(plugin.checkStackCreateUpdateStatus);
      sinon.assert.calledOnce(cfn.createStack);
      sinon.assert.calledOnce(cfn.updateStack);
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
});

describe('test getRegionsToCreateGlobalTablesIn function', () =>{
  const dynamodb = new AWS.DynamoDB();
  const newRegions = [
    'us-west-1',
    'us-east-1'
  ]
  describe('no global table exists', () => {
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
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', serverless.cli);
      resp.missingRegions.should.have.length(2);
      resp.missingRegions.should.eql(newRegions);
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
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', serverless.cli);
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
      const resp = await plugin.getRegionsToCreateGlobalTablesIn(dynamodb, 'us-west-2', newRegions, 'test-table', serverless.cli);
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
  beforeEach(() => {
    dynamodb = new AWS.DynamoDB({ region: 'us-west-2' });
    aas = new AWS.ApplicationAutoScaling({ region: 'us-west-2' });
    sandbox.stub(plugin, 'getRegionsToCreateGlobalTablesIn').returns(Promise.resolve({
      missingRegions: ['us-west-1'],
      addingNewRegions: false
    }));
    sandbox.stub(dynamodb, 'describeTable').returns({
      promise: () => { return Promise.resolve({
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
      })}
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
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], true, serverless.cli);
    sandbox.assert.notCalled(dynamodb.createGlobalTable);
  });

  it ('should create global table', async () => {
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], true, serverless.cli);
    sandbox.assert.calledOnce(dynamodb.createGlobalTable);
  });

  it ('should update the global table', async () => {
    plugin.getRegionsToCreateGlobalTablesIn.restore();
    sandbox.stub(plugin, 'getRegionsToCreateGlobalTablesIn').returns(Promise.resolve({
      missingRegions: ['us-west-1'],
      addingNewRegions: true
    }));
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], true, serverless.cli);
    sandbox.assert.notCalled(dynamodb.createGlobalTable);
    sandbox.assert.calledOnce(dynamodb.updateGlobalTable);
  });

  it ('should create the table when create stack is false', async () => {
    await plugin.createGlobalTable(aas, dynamodb, serverless.getProvider().getCredentials(), 'us-west-2', 'test-table', ['us-east-2'], false, serverless.cli);
    sandbox.assert.calledOnce(dynamodb.describeTable);
  });
});

describe('test getTableNamesFromStack function', () => {
  let cfn;
  before(() => {
    cfn = new AWS.CloudFormation();
    sinon.stub(cfn, 'describeStackResources').returns({
      promise: () => { return Promise.resolve({
        StackResources: [
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
    cfn.describeStackResources.restore();
  });
  it ('should return test-table', async () => {
    const resp = await plugin.getTableNamesFromStack(cfn, 'test-stack');
    resp.should.have.length(1);
    resp[0].should.eql('test-table');
  });
});
