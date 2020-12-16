# serverless-create-global-dynamodb-table
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com) [![Build Status](https://travis-ci.org/rrahul963/serverless-create-global-dynamodb-table.svg?branch=master)](https://travis-ci.org/rrahul963/serverless-create-global-dynamodb-table.svg?branch=master) [![npm version](https://badge.fury.io/js/serverless-create-global-dynamodb-table.svg)](https://badge.fury.io/js/serverless-create-global-dynamodb-table) [![Coverage Status](https://coveralls.io/repos/github/rrahul963/serverless-create-global-dynamodb-table/badge.svg?branch=master)](https://coveralls.io/github/rrahul963/serverless-create-global-dynamodb-table?branch=master)

A [serverless](http://www.serverless.com) plugin to _automatically_ creates [dynamodb global table(s)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html).

By default, the plugin will deploy the whole service stack in the specified region(s) and then setup global table relation between the dynamodb tables.

## Install

`npm install --save-dev serverless-create-global-dynamodb-table`

Add the plugin to your `serverless.yml` file:

```yaml
plugins:
  - serverless-create-global-dynamodb-table
```

## Configuration

```yaml
custom:
  globalTables:
    version: v1 # optional, default is 'v1' (2017.11.29), please use 'v2' for (2019.11.21) version creation
    regions: # list of regions in which you want to set up global tables
      - region-1
      - region-2
    createStack: false # optional flag, when set to false will not deploy the stack in new region(s) and will create the tables using AWS SDK.
                       # if you use 'createStack: true' with 'version: v2', please add 'Condition' rule to your dynamodb to create it in the main region only,
                       # other regions are going to be replicated automatically from the main region.
```

_NOTE_:
1. When creating global tables with `createStack: false`, any update the source table config is not replicated to global tables.   
2. `version` field is backward compatible and not required (the field can be absent).   
If you want to use Global Table (Version 2019.11.21), please use `version: v2`.   
Also, we don't recommend using `v2` over `v1` in your existing project. The plugin doesn't support updating from `v1` to `v2`.   
More details about Global Tables you can find in the following link: [AWS DynamoDB Global Tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)
3. Here is an example of using conditions, by default it's optional, but it's required for `createStack: true` with `version: v2` setup:
```
Conditions:
  RegionUSEast1: !Equals [ !Ref "AWS::Region", us-east-1 ]

MyDynamoDBTable:
    Condition: RegionUSEast1
    Type: 'AWS::DynamoDB::Table'
    DeletionPolicy: Retain
    Properties:
    ....
```
## Revisions
* 2.0.0
  - Updated the package to deploy the service stack in the new region(s) by default
  - Added support to setup auto-scaling on global tables when not using create stack feature.
  - Added unit-tests
* 2.1.0
  - Added support for PAY_PER_REQUEST billing mode for `createStack: true` mode
* 3.1.0
  - Added support to create a new version of Global Table (Version 2019.11.21)

