# serverless-create-global-dynamodb-table
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

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
    regions: # list of regions in which you want to set up global tables
      - region-1
      - region-2
    createStack: false # optional flag, when set to false will not deploy the stack in new region(s) and will create the tables using AWS SDK.
```

_NOTE_: When creating global tables with `createStack: false`, any update the source table config is not replicated to global tables.

